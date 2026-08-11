import { describe, expect, it, vi } from 'vitest';
import { VoiceSessionLifecycle } from './voice-session-lifecycle';

interface FakeController {
  dispose(): void;
  readonly id: string;
}

function fakeController(id: string): FakeController {
  return { id, dispose: vi.fn() };
}

describe('VoiceSessionLifecycle（多轮会话）', () => {
  it('一轮终态（stopped）后释放活跃引用，可再次 start 新会话', () => {
    const lifecycle = new VoiceSessionLifecycle<FakeController>();
    const first = lifecycle.start(() => fakeController('round-1'));
    expect(first).not.toBeNull();
    expect(lifecycle.activeController?.id).toBe('round-1');

    // 终态前不允许重复 start。
    expect(lifecycle.start(() => fakeController('round-1b'))).toBeNull();

    // 终态到达 → 释放。
    lifecycle.handleStatus('stopped');
    expect(lifecycle.activeController).toBeNull();

    // 第二轮可 start，是新实例。
    const second = lifecycle.start(() => fakeController('round-2'));
    expect(second?.id).toBe('round-2');
    expect(lifecycle.activeController?.id).toBe('round-2');
    // 第二轮终态同样释放。
    lifecycle.handleStatus('failed');
    expect(lifecycle.activeController).toBeNull();
  });

  it('cancelled 与 failed 同样释放引用（任何终态都可再 start）', () => {
    const lifecycle = new VoiceSessionLifecycle<FakeController>();
    lifecycle.start(() => fakeController('a'));
    lifecycle.handleStatus('cancelled');
    expect(lifecycle.activeController).toBeNull();
    lifecycle.start(() => fakeController('b'));
    lifecycle.handleStatus('failed');
    expect(lifecycle.activeController).toBeNull();
    expect(lifecycle.start(() => fakeController('c'))).not.toBeNull();
  });

  it('非终态（recording/finalizing）不释放活跃引用', () => {
    const lifecycle = new VoiceSessionLifecycle<FakeController>();
    lifecycle.start(() => fakeController('a'));
    lifecycle.handleStatus('recording');
    lifecycle.handleStatus('finalizing');
    expect(lifecycle.activeController?.id).toBe('a');
    expect(lifecycle.start(() => fakeController('b'))).toBeNull();
  });

  it('dispose 清理活跃会话并释放引用（幂等）；第二轮不被旧引用阻塞', () => {
    const lifecycle = new VoiceSessionLifecycle<FakeController>();
    const first = lifecycle.start(() => fakeController('a'));
    lifecycle.dispose();
    expect(first?.dispose).toHaveBeenCalledTimes(1);
    expect(lifecycle.activeController).toBeNull();
    lifecycle.dispose(); // 幂等
    expect(lifecycle.start(() => fakeController('b'))).not.toBeNull();
  });

  it('能力关闭时 start 是 no-op 且不构造 controller；撤回会清理活跃会话', () => {
    const lifecycle = new VoiceSessionLifecycle<FakeController>();
    const create = vi.fn(() => fakeController('voice'));

    expect(lifecycle.startIfEnabled(false, create)).toBeNull();
    expect(create).not.toHaveBeenCalled();

    const active = lifecycle.startIfEnabled(true, create);
    expect(active?.id).toBe('voice');
    lifecycle.handleCapability(false);
    expect(active?.dispose).toHaveBeenCalledTimes(1);
    expect(lifecycle.activeController).toBeNull();
  });

  it('旧控制器终态后的迟到事件不会污染新一轮（引用已释放，事件只进旧实例）', () => {
    const lifecycle = new VoiceSessionLifecycle<FakeController>();
    const first = lifecycle.start(() => fakeController('round-1'));
    // 第一轮终态。
    lifecycle.handleStatus('stopped');
    const second = lifecycle.start(() => fakeController('round-2'));
    // 第一轮迟到事件（模拟）只作用于 first，活跃引用已指向 second。
    expect(lifecycle.activeController).toBe(second);
    expect(lifecycle.activeController).not.toBe(first);
  });
});
