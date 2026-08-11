'use client';

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { ChatMessageStatus } from '@/features/chat/messages';
import { Pcm16Player, type PcmPlaybackWindow } from './pcm-player';
import {
  createLiveSubtitleCues,
  prepareLiveSpeechText,
  type LiveSubtitleCue,
} from './live-speech-text';
import { takeLiveSpeechSegments } from './live-speech-segments';
import { LiveSpeechResponseGate } from './live-speech-response-gate';

export interface UseLiveSpeechPlaybackOptions {
  readonly enabled: boolean;
  /** clientMessageId 在 local → accepted 消息替换期间保持稳定，不能使用 message.id。 */
  readonly assistantId: string | null;
  readonly assistantText: string | null;
  readonly assistantStatus?: ChatMessageStatus | null;
}

export interface LiveSpeechPlaybackState {
  readonly speaking: boolean;
  readonly preparing: boolean;
  readonly subtitle: string | null;
  readonly outputLevel: number;
  readonly playbackFailed: boolean;
  readonly prepare: () => void;
  /** 用户语音 final 后调用：只允许随后产生的新 Assistant 进入 TTS。 */
  readonly expectNextResponse: () => void;
  readonly cancelPending: () => void;
  readonly interrupt: () => void;
}

export interface LiveSpeechPlaybackViewState {
  readonly phase: 'idle' | 'preparing' | 'speaking';
  readonly subtitle: string | null;
  readonly playbackFailed: boolean;
}

export type LiveSpeechPlaybackAction =
  | { readonly type: 'prepare' }
  | { readonly type: 'start' }
  | { readonly type: 'cue'; readonly text: string }
  | { readonly type: 'finish' | 'interrupt' }
  | { readonly type: 'fail' };

const INITIAL_PLAYBACK_STATE: LiveSpeechPlaybackViewState = {
  phase: 'idle',
  subtitle: null,
  playbackFailed: false,
};

/** 播放终态必须原子清空字幕，避免最后一个 cue 泄漏到下一轮聆听状态。 */
export function reduceLiveSpeechPlayback(
  state: LiveSpeechPlaybackViewState,
  action: LiveSpeechPlaybackAction,
): LiveSpeechPlaybackViewState {
  if (action.type === 'prepare') {
    /* 下一语义段可以在上一段仍播放时预取，状态与字幕不能倒退成“准备中”。 */
    if (state.phase === 'speaking') {
      return { ...state, playbackFailed: false };
    }
    return { phase: 'preparing', subtitle: null, playbackFailed: false };
  }
  if (action.type === 'start') {
    return {
      phase: 'speaking',
      subtitle: state.subtitle,
      playbackFailed: false,
    };
  }
  if (action.type === 'cue') {
    return state.phase === 'speaking'
      ? { ...state, subtitle: action.text }
      : state;
  }
  if (action.type === 'fail') {
    return { phase: 'idle', subtitle: null, playbackFailed: true };
  }
  return { ...state, phase: 'idle', subtitle: null };
}

interface SpeechQueueState {
  assistantId: string | null;
  currentTextLength: number;
  consumedCharacters: number;
  segmentCount: number;
  queue: string[];
  pumping: boolean;
  complete: boolean;
  suppressed: boolean;
  runId: number;
  lastWindow: PcmPlaybackWindow | null;
}

function createQueueState(assistantId: string | null): SpeechQueueState {
  return {
    assistantId,
    currentTextLength: 0,
    consumedCharacters: 0,
    segmentCount: 0,
    queue: [],
    pumping: false,
    complete: false,
    suppressed: false,
    runId: 0,
    lastWindow: null,
  };
}

/**
 * Assistant 的安全 message.delta 到达后立即分段播报。当前 HTTP 路由保持兼容，
 * 语义段按顺序预取并进入同一 Web Audio 队列；后端升级为长连接 Speech Session
 * 时只需替换 `streamSpeechIntoPlayer` 的 transport，不改变字幕与播放状态机。
 */
export function useLiveSpeechPlayback({
  enabled,
  assistantId,
  assistantText,
  assistantStatus = null,
}: UseLiveSpeechPlaybackOptions): LiveSpeechPlaybackState {
  const [viewState, dispatch] = useReducer(
    reduceLiveSpeechPlayback,
    INITIAL_PLAYBACK_STATE,
  );
  const [outputLevel, setOutputLevel] = useState(0);
  const playerRef = useRef<Pcm16Player | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const markerCancelsRef = useRef<Array<() => void>>([]);
  const finishMarkerCancelRef = useRef<(() => void) | null>(null);
  const queueRef = useRef<SpeechQueueState>(createQueueState(null));
  const enabledRef = useRef(enabled);
  const wasEnabledRef = useRef(false);
  const assistantIdRef = useRef(assistantId);
  const responseGateRef = useRef(new LiveSpeechResponseGate());

  const clearAudioResources = useCallback((suppressCurrent: boolean) => {
    const queue = queueRef.current;
    queue.runId += 1;
    queue.queue = [];
    queue.pumping = false;
    queue.lastWindow = null;
    queue.suppressed = suppressCurrent;
    queue.consumedCharacters = queue.currentTextLength;
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    markerCancelsRef.current.splice(0).forEach((cancel) => cancel());
    finishMarkerCancelRef.current?.();
    finishMarkerCancelRef.current = null;
    playerRef.current?.stop();
  }, []);

  const clearAudio = useCallback(
    (suppressCurrent: boolean) => {
      clearAudioResources(suppressCurrent);
      setOutputLevel(0);
    },
    [clearAudioResources],
  );

  const interrupt = useCallback(() => {
    clearAudio(true);
    dispatch({ type: 'interrupt' });
  }, [clearAudio]);

  const prepare = useCallback(() => {
    clearAudioResources(false);
    dispatch({ type: 'finish' });
    setOutputLevel(0);
    playerRef.current ??= new Pcm16Player();
    void playerRef.current.prepare().catch(() => undefined);
  }, [clearAudioResources]);

  const expectNextResponse = useCallback(() => {
    responseGateRef.current.expectNext(assistantIdRef.current);
  }, []);

  const finishWhenPlaybackEnds = useCallback((runId: number) => {
    const queue = queueRef.current;
    if (
      queue.runId !== runId ||
      queue.pumping ||
      queue.queue.length > 0 ||
      !queue.complete
    ) {
      return;
    }
    finishMarkerCancelRef.current?.();
    const lastWindow = queue.lastWindow;
    if (!lastWindow || !playerRef.current) {
      dispatch({ type: 'finish' });
      setOutputLevel(0);
      return;
    }
    finishMarkerCancelRef.current = playerRef.current.scheduleMarker(
      lastWindow.endAt,
      () => {
        if (queueRef.current.runId !== runId) return;
        dispatch({ type: 'finish' });
        setOutputLevel(0);
      },
    );
  }, []);

  const pump = useCallback(() => {
    const queue = queueRef.current;
    if (queue.pumping || queue.suppressed || !enabledRef.current) return;
    queue.pumping = true;
    const runId = queue.runId;
    playerRef.current ??= new Pcm16Player();
    const player = playerRef.current;
    void (async () => {
      try {
        while (
          enabledRef.current &&
          queueRef.current.runId === runId &&
          queueRef.current.queue.length > 0
        ) {
          const rawSegment = queueRef.current.queue.shift()!;
          const speechText = prepareLiveSpeechText(rawSegment);
          if (!speechText) continue;
          finishMarkerCancelRef.current?.();
          finishMarkerCancelRef.current = null;
          dispatch({ type: 'prepare' });
          const controller = new AbortController();
          abortControllerRef.current = controller;
          let heardFirstPcm = false;
          const lastWindow = await streamSpeechIntoPlayer({
            text: speechText,
            signal: controller.signal,
            player,
            cues: createLiveSubtitleCues(speechText),
            onMarker: (at, callback) => {
              markerCancelsRef.current.push(
                player.scheduleMarker(at, callback),
              );
            },
            onLevelMarker: (at, callback) => {
              markerCancelsRef.current.push(
                player.scheduleMarker(at, callback),
              );
            },
            onSubtitle: (text) => {
              if (queueRef.current.runId === runId) {
                dispatch({ type: 'cue', text });
              }
            },
            onFirstAudio: () => {
              if (heardFirstPcm || queueRef.current.runId !== runId) return;
              heardFirstPcm = true;
              dispatch({ type: 'start' });
            },
            onAudioLevel: (level) => {
              if (queueRef.current.runId === runId) setOutputLevel(level);
            },
          });
          if (queueRef.current.runId !== runId) return;
          if (lastWindow) queueRef.current.lastWindow = lastWindow;
        }
      } catch (error: unknown) {
        if (queueRef.current.runId !== runId) return;
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          queueRef.current.suppressed = true;
          dispatch({ type: 'fail' });
        } else {
          dispatch({ type: 'interrupt' });
        }
        setOutputLevel(0);
      } finally {
        if (queueRef.current.runId !== runId) return;
        abortControllerRef.current = null;
        queueRef.current.pumping = false;
        finishWhenPlaybackEnds(runId);
      }
    })();
  }, [finishWhenPlaybackEnds]);

  useEffect(() => {
    enabledRef.current = enabled;
    assistantIdRef.current = assistantId;
    if (!enabled) {
      wasEnabledRef.current = false;
      responseGateRef.current.reset(assistantId);
      clearAudioResources(false);
      queueRef.current = createQueueState(assistantId);
      queueRef.current.currentTextLength = assistantText?.length ?? 0;
      queueRef.current.consumedCharacters = assistantText?.length ?? 0;
      return;
    }
    if (!wasEnabledRef.current) {
      wasEnabledRef.current = true;
      responseGateRef.current.reset(assistantId);
      queueRef.current = createQueueState(assistantId);
      queueRef.current.currentTextLength = assistantText?.length ?? 0;
      queueRef.current.consumedCharacters = assistantText?.length ?? 0;
      return;
    }
    if (!assistantId) return;
    if (!responseGateRef.current.accepts(assistantId)) return;
    const text = assistantText ?? '';
    if (queueRef.current.assistantId !== assistantId) {
      clearAudio(false);
      queueRef.current = createQueueState(assistantId);
    }
    const queue = queueRef.current;
    queue.currentTextLength = text.length;
    if (queue.suppressed) return;
    if (text.length < queue.consumedCharacters) {
      clearAudio(true);
      return;
    }
    const terminalFailure =
      assistantStatus === 'failed' ||
      assistantStatus === 'cancelled' ||
      assistantStatus === 'interrupted';
    if (terminalFailure) {
      clearAudioResources(true);
      queueMicrotask(() => {
        setOutputLevel(0);
        dispatch({ type: 'interrupt' });
      });
      return;
    }
    queue.complete = assistantStatus === 'completed';
    const batch = takeLiveSpeechSegments({
      text,
      consumedCharacters: queue.consumedCharacters,
      segmentCount: queue.segmentCount,
      complete: queue.complete,
    });
    queue.consumedCharacters = batch.consumedCharacters;
    queue.segmentCount += batch.segments.length;
    queue.queue.push(...batch.segments);
    if (queue.queue.length > 0) pump();
    else finishWhenPlaybackEnds(queue.runId);
  }, [
    assistantId,
    assistantStatus,
    assistantText,
    clearAudio,
    clearAudioResources,
    enabled,
    finishWhenPlaybackEnds,
    pump,
  ]);

  useEffect(
    () => () => {
      clearAudioResources(false);
      void playerRef.current?.close();
    },
    [clearAudioResources],
  );

  const visibleState = enabled ? viewState : INITIAL_PLAYBACK_STATE;

  return {
    speaking: visibleState.phase === 'speaking',
    preparing: visibleState.phase === 'preparing',
    subtitle: visibleState.subtitle,
    outputLevel: enabled ? outputLevel : 0,
    playbackFailed: visibleState.playbackFailed,
    prepare,
    expectNextResponse,
    cancelPending: interrupt,
    interrupt,
  };
}

export interface LiveSpeechPcmPlayer {
  enqueue(bytes: Uint8Array): Promise<PcmPlaybackWindow | null>;
}

interface StreamSpeechOptions {
  readonly text: string;
  readonly signal: AbortSignal;
  readonly player: LiveSpeechPcmPlayer;
  readonly cues: readonly LiveSubtitleCue[];
  readonly onMarker: (at: number, callback: () => void) => void;
  /** 输出能量也必须绑定播放时钟，不能用提前下载到的 PCM 驱动球体。 */
  readonly onLevelMarker?: (at: number, callback: () => void) => void;
  readonly onSubtitle: (text: string) => void;
  readonly onFirstAudio?: (window: PcmPlaybackWindow) => void;
  readonly onAudioLevel?: (level: number) => void;
  readonly fetchImpl?: typeof fetch;
}

function pcmLevel(bytes: Uint8Array): number {
  if (bytes.byteLength < 2) return 0;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let sum = 0;
  const samples = Math.floor(bytes.byteLength / 2);
  for (let index = 0; index < samples; index += 1) {
    const value = view.getInt16(index * 2, true) / 32_768;
    sum += value * value;
  }
  return Math.min(1, Math.sqrt(sum / samples) * 4.5);
}

export async function streamSpeechIntoPlayer({
  text,
  signal,
  player,
  cues,
  onMarker,
  onLevelMarker,
  onSubtitle,
  onFirstAudio,
  onAudioLevel,
  fetchImpl = fetch,
}: StreamSpeechOptions): Promise<PcmPlaybackWindow | null> {
  const response = await fetchImpl('/api/v1/voice/live/speech', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
    signal,
  });
  if (!response.ok || !response.body) throw new Error('speech');
  const reader = response.body.getReader();
  let carry: Uint8Array | null = null;
  let queuedContentSeconds = 0;
  let nextCueIndex = 0;
  let lastWindow: PcmPlaybackWindow | null = null;
  let firstAudioDelivered = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    let bytes = value;
    if (carry) {
      const joined = new Uint8Array(carry.byteLength + value.byteLength);
      joined.set(carry);
      joined.set(value, carry.byteLength);
      bytes = joined;
      carry = null;
    }
    if (bytes.byteLength % 2 === 1) {
      carry = bytes.slice(-1);
      bytes = bytes.slice(0, -1);
    }
    const level = pcmLevel(bytes);
    const window = await player.enqueue(bytes);
    if (!window) continue;
    if (onAudioLevel) {
      (onLevelMarker ?? onMarker)(window.startAt, () => onAudioLevel(level));
    }
    if (!firstAudioDelivered) {
      firstAudioDelivered = true;
      onFirstAudio?.(window);
    }
    const contentBeforeWindow = queuedContentSeconds;
    queuedContentSeconds += window.durationSeconds;
    lastWindow = window;
    while (
      nextCueIndex < cues.length &&
      cues[nextCueIndex]!.startOffsetSeconds <= queuedContentSeconds
    ) {
      const cue = cues[nextCueIndex]!;
      const withinWindow = Math.max(
        0,
        cue.startOffsetSeconds - contentBeforeWindow,
      );
      const markerAt =
        window.startAt + Math.min(window.durationSeconds, withinWindow);
      onMarker(markerAt, () => onSubtitle(cue.text));
      nextCueIndex += 1;
    }
  }
  return lastWindow;
}
