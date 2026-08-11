'use client';

import { useEffect, useRef, useState } from 'react';
import type { VoiceSessionStatus } from './voice-session-controller';

/** Gateway 单 operation 保留 60 秒 PCM 安全上限；Live 在上限前主动轮换。 */
export const LIVE_ASR_ROTATION_MS = 45_000;

export function resolveLiveAsrRotationAction(
  partialText: string,
): 'cancel' | 'finish' {
  return partialText.trim() ? 'finish' : 'cancel';
}

interface LiveTranscriptionContinuityOptions {
  readonly active: boolean;
  readonly status: VoiceSessionStatus;
  readonly partialText: string;
  readonly start: () => void;
  readonly stop: () => void;
  readonly cancel: () => void;
}

/**
 * 把多个短生命周期 ASR operation 编排为一个连续 Live 会话。
 *
 * - 入室和取消静音必须能从上一轮 failed 重新启动；
 * - 瞬时失败只自动恢复一次，配置错误不得无限重连；
 * - 45 秒主动轮换，避免正常沉默撞上 Gateway 的 60 秒 PCM 安全配额。
 */
export function useLiveTranscriptionContinuity({
  active,
  status,
  partialText,
  start,
  stop,
  cancel,
}: LiveTranscriptionContinuityOptions): {
  readonly recovering: boolean;
  readonly rotating: boolean;
} {
  const [recovering, setRecovering] = useState(false);
  const [rotating, setRotating] = useState(false);
  const activationRef = useRef(false);
  const activationStartPendingRef = useRef(false);
  const retryUsedRef = useRef(false);
  const partialTextRef = useRef(partialText);

  useEffect(() => {
    partialTextRef.current = partialText;
  }, [partialText]);

  useEffect(() => {
    if (!active) {
      activationRef.current = false;
      activationStartPendingRef.current = false;
      retryUsedRef.current = false;
      setRecovering(false);
      setRotating(false);
      cancel();
      return;
    }
    const firstActivation = !activationRef.current;
    activationRef.current = true;
    if (firstActivation) activationStartPendingRef.current = true;
    if (
      firstActivation ||
      status === 'idle' ||
      status === 'stopped' ||
      status === 'cancelled'
    ) {
      start();
    }
  }, [active, cancel, start, status]);

  useEffect(() => {
    if (!active) return undefined;
    if (status === 'stopped') {
      retryUsedRef.current = false;
      return undefined;
    }
    if (
      status === 'starting' ||
      status === 'authorizing' ||
      status === 'recording'
    ) {
      activationStartPendingRef.current = false;
    }
    if (status === 'recording') {
      setRecovering(false);
      setRotating(false);
      return undefined;
    }
    if (status !== 'failed') return undefined;
    if (activationStartPendingRef.current) return undefined;
    if (retryUsedRef.current) {
      setRecovering(false);
      return undefined;
    }
    retryUsedRef.current = true;
    setRecovering(true);
    const timer = window.setTimeout(() => start(), 500);
    return () => window.clearTimeout(timer);
  }, [active, start, status]);

  useEffect(() => {
    if (!active || status !== 'recording') return undefined;
    const timer = window.setTimeout(() => {
      const action = resolveLiveAsrRotationAction(partialTextRef.current);
      if (action === 'finish') {
        stop();
        return;
      }
      setRotating(true);
      cancel();
    }, LIVE_ASR_ROTATION_MS);
    return () => window.clearTimeout(timer);
  }, [active, cancel, status, stop]);

  return { recovering, rotating };
}
