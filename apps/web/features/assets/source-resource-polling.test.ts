import type { CanvasResource } from '@educanvas/canvas-protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { pollSourceResource } from './source-resource-polling';

function resource(status: CanvasResource['status']): CanvasResource {
  return { status } as CanvasResource;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('pollSourceResource', () => {
  it('只轮询元数据，并在 processing → ready 后停止', async () => {
    vi.useFakeTimers();
    const load = vi
      .fn()
      .mockResolvedValueOnce(resource('processing'))
      .mockResolvedValueOnce(resource('ready'));
    const promise = pollSourceResource({
      resourceId: 'source-1',
      signal: new AbortController().signal,
      delayMs: 10,
      load,
    });

    await vi.advanceTimersByTimeAsync(20);

    await expect(promise).resolves.toMatchObject({ status: 'ready' });
    expect(load).toHaveBeenCalledTimes(2);
    expect(load).toHaveBeenNthCalledWith(
      1,
      'source-1',
      expect.any(AbortSignal),
    );
  });

  it.each(['failed', 'unavailable'] as const)(
    '在 %s 终态立即停止',
    async (status) => {
      vi.useFakeTimers();
      const load = vi.fn().mockResolvedValue(resource(status));
      const promise = pollSourceResource({
        resourceId: 'source-1',
        signal: new AbortController().signal,
        delayMs: 10,
        load,
      });

      await vi.advanceTimersByTimeAsync(10);

      await expect(promise).resolves.toMatchObject({ status });
      expect(load).toHaveBeenCalledTimes(1);
    },
  );

  it('卸载或资源切换时 Abort 会取消等待且不发请求', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const load = vi.fn();
    const promise = pollSourceResource({
      resourceId: 'source-1',
      signal: controller.signal,
      delayMs: 10,
      load,
    });

    controller.abort();

    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    expect(load).not.toHaveBeenCalled();
  });

  it('读取失败向 Renderer 透传，由显式重试启动新一轮', async () => {
    vi.useFakeTimers();
    const failure = new Error('stable failure');
    const promise = pollSourceResource({
      resourceId: 'source-1',
      signal: new AbortController().signal,
      delayMs: 10,
      load: vi.fn().mockRejectedValue(failure),
    });
    const rejected = expect(promise).rejects.toBe(failure);

    await vi.advanceTimersByTimeAsync(10);

    await rejected;
  });
});
