import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { installWorkerShutdownHandlers } from './process-lifecycle';

describe('worker process lifecycle', () => {
  it('首个信号只停止Runner一次并移除全部监听', async () => {
    const target = new EventEmitter();
    const stop = vi.fn(async () => {});
    const onSignal = vi.fn();
    installWorkerShutdownHandlers({
      runner: { stop },
      target,
      onSignal,
    });

    target.emit('SIGTERM');
    target.emit('SIGINT');
    await vi.waitFor(() => expect(stop).toHaveBeenCalledTimes(1));
    expect(onSignal).toHaveBeenCalledWith('SIGTERM');
    expect(target.eventNames()).toEqual([]);
  });

  it('将Runner停止失败交给组合根处理', async () => {
    const target = new EventEmitter();
    const failure = new Error('runner_stop_failed');
    const onError = vi.fn();
    installWorkerShutdownHandlers({
      runner: { stop: vi.fn(async () => Promise.reject(failure)) },
      target,
      onError,
    });

    target.emit('SIGINT');
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(failure));
  });
});
