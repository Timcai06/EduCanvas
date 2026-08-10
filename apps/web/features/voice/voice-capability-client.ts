'use client';

import { useEffect, useState } from 'react';
import { z } from 'zod';
import type { VoiceCapabilityCheck } from './voice-capability';

const CAPABILITY_REFRESH_MS = 15_000;

const capabilityResponseSchema = z
  .object({
    checks: z
      .array(
        z
          .object({
            key: z.enum([
              'model',
              'connection',
              'consent',
              'retention',
              'deletion-worker',
            ]),
            healthy: z.boolean(),
          })
          .strict(),
      )
      .length(5),
    websocketUrl: z
      .string()
      .url()
      .refine((value) => ['ws:', 'wss:'].includes(new URL(value).protocol))
      .nullable(),
  })
  .strict();

const UNAVAILABLE_CHECKS: readonly VoiceCapabilityCheck[] = [
  { key: 'model', healthy: false },
  { key: 'connection', healthy: false },
  { key: 'consent', healthy: false },
  { key: 'retention', healthy: false },
  { key: 'deletion-worker', healthy: false },
];

export interface VoiceCapabilityQueryState {
  readonly loading: boolean;
  readonly checks: readonly VoiceCapabilityCheck[];
  readonly websocketUrl: string | null;
}

/** 同源读取服务端总闸门；失败保持关闭，不把响应原文带进 UI。 */
export function useVoiceCapabilityQuery(): VoiceCapabilityQueryState {
  const [state, setState] = useState<VoiceCapabilityQueryState>({
    loading: true,
    checks: UNAVAILABLE_CHECKS,
    websocketUrl: null,
  });
  useEffect(() => {
    const controller = new AbortController();
    const refresh = () => {
      void fetch('/api/v1/voice/capability', {
        cache: 'no-store',
        signal: controller.signal,
      })
        .then(async (response) => {
          if (!response.ok) throw new Error('capability unavailable');
          return capabilityResponseSchema.parse(await response.json());
        })
        .then((result) => {
          setState({
            loading: false,
            checks: result.checks,
            websocketUrl: result.websocketUrl,
          });
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            setState({
              loading: false,
              checks: UNAVAILABLE_CHECKS,
              websocketUrl: null,
            });
          }
        });
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    refresh();
    const timer = window.setInterval(refresh, CAPABILITY_REFRESH_MS);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, []);
  return state;
}
