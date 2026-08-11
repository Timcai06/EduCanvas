'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createAudioCapture,
  type AudioCapture,
  type AudioContextLike,
} from '../capture/audio-capture';
import { encodePcm16LeWav } from './wav';

const MAX_PCM_BYTES = 60 * 16_000 * 2;
const MAX_DURATION_MS = 60_000;

type DictationStatus =
  | 'idle'
  | 'starting'
  | 'recording'
  | 'finalizing'
  | 'stopped'
  | 'cancelled'
  | 'failed';

interface DictationCapability {
  enabled: boolean;
  reason:
    | 'login_required'
    | 'experience_mode_required'
    | 'transcription_unavailable'
    | null;
}

const REASON_LABELS: Record<
  Exclude<DictationCapability['reason'], null>,
  string
> = {
  login_required: '请先登录后使用语音转文字',
  experience_mode_required: '请先选择使用模式',
  transcription_unavailable: '语音转文字暂不可用',
};

export interface DictationState {
  enabled: boolean;
  status: DictationStatus;
  reason: string | null;
  start: () => void;
  stop: () => void;
  cancel: () => void;
}

export function useDictation(onText: (text: string) => void): DictationState {
  const [capability, setCapability] = useState<DictationCapability>({
    enabled: false,
    reason: 'transcription_unavailable',
  });
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<DictationStatus>('idle');
  const [inFlight, setInFlight] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const captureRef = useRef<AudioCapture | null>(null);
  const chunksRef = useRef<Uint8Array[]>([]);
  const bytesRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    void fetch('/api/v1/voice/dictation/capability', {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('capability');
        return (await response.json()) as DictationCapability;
      })
      .then((result) => {
        if (active) setCapability(result);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, []);

  const clearTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const submit = useCallback(async () => {
    if (inFlightRef.current || bytesRef.current === 0) {
      setStatus(bytesRef.current === 0 ? 'idle' : 'failed');
      return;
    }
    inFlightRef.current = true;
    setInFlight(true);
    setStatus('finalizing');
    const wav = encodePcm16LeWav(chunksRef.current);
    chunksRef.current = [];
    bytesRef.current = 0;
    try {
      const response = await fetch('/api/v1/voice/dictation', {
        method: 'POST',
        headers: { 'content-type': 'audio/wav' },
        body: wav.slice().buffer,
      });
      if (!response.ok) throw new Error('dictation');
      const body = (await response.json()) as { text?: unknown };
      if (typeof body.text !== 'string') throw new Error('response');
      if (body.text.trim()) onText(body.text.trim());
      setError(null);
      setStatus('stopped');
    } catch {
      setError('语音转文字失败，请重试');
      setStatus('failed');
    } finally {
      inFlightRef.current = false;
      setInFlight(false);
    }
  }, [onText]);

  const stop = useCallback(() => {
    clearTimer();
    const capture = captureRef.current;
    captureRef.current = null;
    if (!capture) return;
    capture.stop();
    void submit();
  }, [clearTimer, submit]);

  const cancel = useCallback(() => {
    clearTimer();
    captureRef.current?.cancel();
    captureRef.current = null;
    chunksRef.current = [];
    bytesRef.current = 0;
    setStatus('cancelled');
  }, [clearTimer]);

  const start = useCallback(() => {
    if (!capability.enabled || inFlightRef.current || captureRef.current)
      return;
    setError(null);
    chunksRef.current = [];
    bytesRef.current = 0;
    const browser = globalThis as typeof globalThis & {
      navigator: Navigator;
      AudioContext?: new () => AudioContext;
      webkitAudioContext?: new () => AudioContext;
    };
    const AudioContextCtor = browser.AudioContext ?? browser.webkitAudioContext;
    if (!browser.navigator?.mediaDevices || !AudioContextCtor) {
      setError('当前浏览器无法使用麦克风');
      setStatus('failed');
      return;
    }
    const capture = createAudioCapture({
      mediaDevices: browser.navigator.mediaDevices,
      audioContextFactory: () =>
        new AudioContextCtor() as unknown as AudioContextLike,
      onChunk: ({ pcmBytes }) => {
        if (bytesRef.current + pcmBytes.byteLength > MAX_PCM_BYTES) {
          queueMicrotask(stop);
          return;
        }
        chunksRef.current.push(pcmBytes.slice());
        bytesRef.current += pcmBytes.byteLength;
      },
      onFailure: () => {
        setError('麦克风采集失败，请重试');
        setStatus('failed');
      },
    });
    captureRef.current = capture;
    setStatus('starting');
    void capture
      .start()
      .then((result) => {
        if (result.status !== 'recording') return;
        setStatus('recording');
        timerRef.current = setTimeout(stop, MAX_DURATION_MS);
      })
      .catch(() => {
        captureRef.current = null;
        setError('无法启动麦克风，请检查权限');
        setStatus('failed');
      });
  }, [capability.enabled, stop]);

  useEffect(
    () => () => {
      clearTimer();
      captureRef.current?.cancel();
      captureRef.current = null;
      chunksRef.current = [];
      bytesRef.current = 0;
    },
    [clearTimer],
  );

  return {
    enabled: capability.enabled && !inFlight,
    status,
    reason: loading
      ? '正在检查语音转文字能力…'
      : (error ??
        (capability.reason ? REASON_LABELS[capability.reason] : null)),
    start,
    stop,
    cancel,
  };
}
