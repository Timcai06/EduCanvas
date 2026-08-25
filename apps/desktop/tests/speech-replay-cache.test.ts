import { describe, expect, it, vi } from 'vitest';
import { createSpeechReplayCache } from '../src/main/speech-replay-cache';

const input = {
  text: '这是原来的模型声音。',
  assistantMessageId: 'message:assistant:one',
};

describe('speech replay cache', () => {
  it('lets playback join an original-voice hover prefetch', async () => {
    let finish!: (value: {
      ok: true;
      bytes: Uint8Array;
      contentType: 'audio/mpeg';
    }) => void;
    const synthesize = vi.fn(
      () =>
        new Promise<{
          ok: true;
          bytes: Uint8Array;
          contentType: 'audio/mpeg';
        }>((resolve) => {
          finish = resolve;
        }),
    );
    const cache = createSpeechReplayCache(synthesize);

    cache.prefetch(input);
    const playback = cache.synthesize(input);
    finish({
      ok: true,
      bytes: Uint8Array.from([1, 2, 3]),
      contentType: 'audio/mpeg',
    });

    await expect(playback).resolves.toMatchObject({ ok: true });
    expect(synthesize).toHaveBeenCalledOnce();
  });

  it('reuses the latest completed original-voice audio', async () => {
    const synthesize = vi.fn(async () => ({
      ok: true as const,
      bytes: Uint8Array.from([1, 2, 3]),
      contentType: 'audio/mpeg' as const,
    }));
    const cache = createSpeechReplayCache(synthesize);

    await cache.synthesize(input);
    await cache.synthesize(input);

    expect(synthesize).toHaveBeenCalledOnce();
  });

  it('allows a click to cancel its wait without cancelling shared prefetch', async () => {
    let finish!: (value: {
      ok: true;
      bytes: Uint8Array;
      contentType: 'audio/mpeg';
    }) => void;
    const synthesize = vi.fn(
      () =>
        new Promise<{
          ok: true;
          bytes: Uint8Array;
          contentType: 'audio/mpeg';
        }>((resolve) => {
          finish = resolve;
        }),
    );
    const cache = createSpeechReplayCache(synthesize);
    const controller = new AbortController();
    cache.prefetch(input);
    const playback = cache.synthesize(input, controller.signal);

    controller.abort();
    await expect(playback).resolves.toMatchObject({
      ok: false,
      code: 'aborted',
    });
    finish({
      ok: true,
      bytes: Uint8Array.from([1]),
      contentType: 'audio/mpeg',
    });
    await Promise.resolve();
    await expect(cache.synthesize(input)).resolves.toMatchObject({ ok: true });
    expect(synthesize).toHaveBeenCalledOnce();
  });
});
