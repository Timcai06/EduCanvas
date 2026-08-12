import { describe, expect, it, vi } from 'vitest';
import { Pcm16Player } from './pcm-player';

class FakeSource {
  buffer: { duration: number } | null = null;
  onended: (() => void) | null = null;
  startedAt: number | null = null;

  connect() {}

  start(at: number) {
    this.startedAt = at;
  }

  stop() {
    this.onended?.();
  }

  finish() {
    this.onended?.();
  }
}

class FakeAudioContext {
  state: AudioContextState = 'running';
  currentTime = 0;
  destination = {} as AudioDestinationNode;
  readonly sources: FakeSource[] = [];
  closeCount = 0;

  async resume() {}

  async close() {
    this.closeCount += 1;
  }

  createBuffer(_channels: number, length: number, sampleRate: number) {
    return {
      duration: length / sampleRate,
      copyToChannel: () => undefined,
    };
  }

  createBufferSource() {
    const source = new FakeSource();
    this.sources.push(source);
    return source;
  }
}

class ControlledResumeAudioContext extends FakeAudioContext {
  override state: AudioContextState = 'suspended';
  private resumeResolve: (() => void) | null = null;
  readonly resumeSignal = new Promise<void>((resolve) => {
    this.resumeResolve = resolve;
  });

  override async resume() {
    await this.resumeSignal;
  }

  releaseResume() {
    this.resumeResolve?.();
    this.resumeResolve = null;
  }
}

describe('Pcm16Player', () => {
  it('返回真实 Web Audio 排期并连续衔接 PCM chunk', async () => {
    const context = new FakeAudioContext();
    const player = new Pcm16Player(() => context as unknown as AudioContext);
    const first = await player.enqueue(new Uint8Array(48_000));
    context.currentTime = 0.25;
    const second = await player.enqueue(new Uint8Array(24_000));

    expect(first).toEqual({
      startAt: 0,
      endAt: 1,
      durationSeconds: 1,
    });
    expect(second).toEqual({
      startAt: 1,
      endAt: 1.5,
      durationSeconds: 0.5,
    });
    expect(
      context.sources.slice(0, 2).map((source) => source.startedAt),
    ).toEqual([0, 1]);
  });

  it('字幕标记跟随音频时钟且 stop 后不会触发回调', async () => {
    const context = new FakeAudioContext();
    const player = new Pcm16Player(() => context as unknown as AudioContext);
    await player.enqueue(new Uint8Array(4_800));
    const played = vi.fn();
    player.scheduleMarker(0.08, played);
    const activeMarker = context.sources.at(-1)!;
    activeMarker.finish();
    expect(played).toHaveBeenCalledOnce();

    const cancelled = vi.fn();
    player.scheduleMarker(0.16, cancelled);
    player.stop();
    expect(cancelled).not.toHaveBeenCalled();
  });

  it('空/奇数长度 PCM 不能进入播放窗口', async () => {
    const context = new FakeAudioContext();
    const player = new Pcm16Player(() => context as unknown as AudioContext);
    expect(await player.enqueue(new Uint8Array())).toBeNull();
    expect(await player.enqueue(new Uint8Array([1]))).toBeNull();
  });

  it('stop 与 enqueue 竞争时不产生幽灵 source', async () => {
    const context = new ControlledResumeAudioContext();
    const player = new Pcm16Player(() => context as unknown as AudioContext);
    const pendingWindow = player.enqueue(new Uint8Array(2_400));
    player.stop();
    context.releaseResume();
    const window = await pendingWindow;
    expect(window).toBeNull();
    expect(context.sources).toHaveLength(0);
    expect(context.closeCount).toBe(1);
  });
});
