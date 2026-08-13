import { describe, expect, it } from 'vitest';
import { IpcAbortRegistry } from '../src/main/ipc-abort-registry';

describe('IPC 请求取消注册表', () => {
  it('按 requestId 中止正在运行的请求并释放引用', () => {
    const registry = new IpcAbortRegistry();
    const signal = registry.begin('request-1');

    expect(registry.cancel('request-1')).toBe(true);
    expect(signal.aborted).toBe(true);
    expect(registry.cancel('request-1')).toBe(false);
  });

  it('正常完成只删除自己的 controller，不误删同 ID 的新请求', () => {
    const registry = new IpcAbortRegistry();
    const first = registry.begin('request-1');
    const second = registry.begin('request-1');

    expect(first.aborted).toBe(true);
    registry.finish('request-1', first);
    expect(registry.cancel('request-1')).toBe(true);
    expect(second.aborted).toBe(true);
  });

  it('拒绝空白或过长 requestId，防止 renderer 扩张注册表键空间', () => {
    const registry = new IpcAbortRegistry();

    expect(() => registry.begin('')).toThrow(/requestId/);
    expect(() => registry.begin('x'.repeat(129))).toThrow(/requestId/);
  });

  it('按 renderer owner 取消窗口销毁后遗留的请求', () => {
    const registry = new IpcAbortRegistry();
    const first = registry.begin('request-1', 7);
    const second = registry.begin('request-2', 8);

    expect(registry.cancelOwner(7)).toBe(1);
    expect(first.aborted).toBe(true);
    expect(second.aborted).toBe(false);
  });
});
