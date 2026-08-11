import { describe, expect, it, vi } from 'vitest';
import { createWarmMediaDevices } from './voice-browser-runtime';

function streamFixture() {
  const stop = vi.fn();
  const cloneStops: ReturnType<typeof vi.fn>[] = [];
  const clone = vi.fn(() => {
    const cloneStop = vi.fn();
    cloneStops.push(cloneStop);
    const track = {
      readyState: 'live' as const,
      stop: cloneStop,
      addEventListener: vi.fn(),
    };
    return { getTracks: () => [track] } as unknown as MediaStream;
  });
  const track = { readyState: 'live' as const, stop };
  return {
    stream: { getTracks: () => [track], clone } as unknown as MediaStream,
    stop,
    clone,
    cloneStops,
  };
}

describe('Live Voice warm MediaStream pool', () => {
  it('多轮 capture 复用同一个授权流，退出 Live 才停止真实 track', async () => {
    const fixture = streamFixture();
    const getUserMedia = vi.fn(async () => fixture.stream);
    const pool = createWarmMediaDevices(
      { getUserMedia } as unknown as MediaDevices,
      60_000,
    );

    const first = await pool.devices.getUserMedia({ audio: true });
    first.getTracks()[0]!.stop();
    const second = await pool.devices.getUserMedia({ audio: true });
    second.getTracks()[0]!.stop();

    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(fixture.clone).toHaveBeenCalledTimes(2);
    expect(fixture.cloneStops).toHaveLength(2);
    expect(
      fixture.cloneStops.every((stop) => stop.mock.calls.length === 1),
    ).toBe(true);
    expect(fixture.stop).not.toHaveBeenCalled();
    pool.dispose();
    expect(fixture.stop).toHaveBeenCalledTimes(1);
  });

  it('权限请求尚未返回时退出 Live，也会回收随后到达的 track', async () => {
    const fixture = streamFixture();
    let resolveStream!: (stream: MediaStream) => void;
    const getUserMedia = vi.fn(
      () =>
        new Promise<MediaStream>((resolve) => {
          resolveStream = resolve;
        }),
    );
    const pool = createWarmMediaDevices({
      getUserMedia,
    } as unknown as MediaDevices);

    const pending = pool.devices.getUserMedia({ audio: true });
    pool.dispose();
    resolveStream(fixture.stream);

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(fixture.stop).toHaveBeenCalledTimes(1);
  });
});
