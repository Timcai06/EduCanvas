import { describe, expect, it } from 'vitest';
import {
  playSpeech,
  type SpeechPlayerDependencies,
} from '../src/renderer/src/speech-player';

function harness() {
  let ended: (() => void) | null = null;
  let stopped = 0;
  let closed = 0;
  const dependencies: SpeechPlayerDependencies = {
    decode: async () => ({ duration: 1 }),
    play: (_buffer, onEnded) => {
      ended = onEnded;
      return { stop: () => (stopped += 1) };
    },
    close: async () => {
      closed += 1;
    },
  };
  return {
    dependencies,
    finish: () => ended?.(),
    counts: () => ({ stopped, closed }),
  };
}

describe('playSpeech', () => {
  it('播放自然结束后关闭 AudioContext', async () => {
    const h = harness();
    const pending = playSpeech(Uint8Array.from([1, 2, 3]), {}, h.dependencies);
    await Promise.resolve();
    h.finish();

    await expect(pending).resolves.toBe('finished');
    expect(h.counts()).toEqual({ stopped: 0, closed: 1 });
  });

  it('取消会停止 source、关闭 AudioContext 并返回 aborted', async () => {
    const h = harness();
    const controller = new AbortController();
    const pending = playSpeech(
      Uint8Array.from([1, 2, 3]),
      { signal: controller.signal },
      h.dependencies,
    );
    await Promise.resolve();

    controller.abort();

    await expect(pending).resolves.toBe('aborted');
    expect(h.counts()).toEqual({ stopped: 1, closed: 1 });
  });

  it('解码失败收敛为 failed 且仍释放上下文', async () => {
    const h = harness();
    h.dependencies.decode = async () => {
      throw new Error('provider bytes');
    };

    await expect(
      playSpeech(Uint8Array.from([1]), {}, h.dependencies),
    ).resolves.toBe('failed');
    expect(h.counts().closed).toBe(1);
  });
});
