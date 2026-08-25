import type { VoiceSpeechResult } from '../shared/voice-result';

export interface SpeechReplayInput {
  text: string;
  assistantMessageId?: string;
}

type SynthesizeSpeech = (
  input: SpeechReplayInput,
  signal?: AbortSignal,
) => Promise<VoiceSpeechResult>;

function cacheKey(input: SpeechReplayInput): string {
  return `${input.assistantMessageId ?? ''}\u0000${input.text}`;
}

function abortedSpeech(): VoiceSpeechResult {
  return { ok: false, code: 'aborted', message: '已取消。' };
}

async function waitForSharedSpeech(
  pending: Promise<VoiceSpeechResult>,
  signal?: AbortSignal,
): Promise<VoiceSpeechResult> {
  if (!signal) return pending;
  if (signal.aborted) return abortedSpeech();
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: VoiceSpeechResult): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      resolve(result);
    };
    const onAbort = (): void => finish(abortedSpeech());
    signal.addEventListener('abort', onAbort, { once: true });
    void pending.then(finish);
  });
}

/**
 * Keeps one original-provider speech result and deduplicates in-flight replay
 * generation. Hover prefetch does not hold the UI operation lease; a later
 * click joins the same bounded provider request and retains normal cancellation.
 */
export function createSpeechReplayCache(synthesize: SynthesizeSpeech) {
  let cached: { key: string; result: VoiceSpeechResult & { ok: true } } | null =
    null;
  const pending = new Map<string, Promise<VoiceSpeechResult>>();

  const generate = (
    input: SpeechReplayInput,
    signal?: AbortSignal,
  ): Promise<VoiceSpeechResult> => {
    const key = cacheKey(input);
    const existing = pending.get(key);
    if (existing) return waitForSharedSpeech(existing, signal);
    const request = synthesize(input, signal)
      .then((result) => {
        if (result.ok) cached = { key, result };
        return result;
      })
      .catch((): VoiceSpeechResult => ({
        ok: false,
        code: 'backend_offline',
        message: '语音服务暂不可用。',
      }))
      .finally(() => pending.delete(key));
    pending.set(key, request);
    return request;
  };

  return {
    prefetch(input: SpeechReplayInput): void {
      const key = cacheKey(input);
      if (cached?.key === key || pending.has(key) || pending.size > 0) return;
      void generate(input);
    },
    synthesize(
      input: SpeechReplayInput,
      signal?: AbortSignal,
    ): Promise<VoiceSpeechResult> {
      const key = cacheKey(input);
      if (cached?.key === key) return Promise.resolve(cached.result);
      return generate(input, signal);
    },
  };
}
