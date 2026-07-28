import { describe, expect, it } from 'vitest';
import { CanvasResourceOpenGate } from './canvas-resource-open-gate';

describe('CanvasResourceOpenGate', () => {
  it('只有最新请求可以提交', () => {
    const gate = new CanvasResourceOpenGate();
    const first = gate.begin();
    const second = gate.begin();

    expect(first.signal.aborted).toBe(true);
    expect(gate.isCurrent(first.token)).toBe(false);
    expect(gate.isCurrent(second.token)).toBe(true);
  });

  it('close 或 Notebook 切换会取消当前请求', () => {
    const gate = new CanvasResourceOpenGate();
    const request = gate.begin();

    gate.cancel();

    expect(request.signal.aborted).toBe(true);
    expect(gate.isCurrent(request.token)).toBe(false);
  });

  it('取消后可以开始独立的新请求', () => {
    const gate = new CanvasResourceOpenGate();
    const first = gate.begin();
    gate.cancel();
    const next = gate.begin();

    expect(gate.isCurrent(first.token)).toBe(false);
    expect(gate.isCurrent(next.token)).toBe(true);
  });
});
