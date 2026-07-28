import { describe, expect, it } from 'vitest';
import { CanvasResourceOpenGate } from './canvas-resource-open-gate';

describe('CanvasResourceOpenGate', () => {
  it('只有最新请求可以提交', () => {
    const gate = new CanvasResourceOpenGate();
    const first = gate.begin('notebook-a');
    const second = gate.begin('notebook-a');

    expect(first.signal.aborted).toBe(true);
    expect(gate.isCurrent(first, 'notebook-a')).toBe(false);
    expect(gate.isCurrent(second, 'notebook-a')).toBe(true);
  });

  it('close 或 Notebook 切换会取消当前请求', () => {
    const gate = new CanvasResourceOpenGate();
    const request = gate.begin('notebook-a');

    gate.cancel();

    expect(request.signal.aborted).toBe(true);
    expect(gate.isCurrent(request, 'notebook-a')).toBe(false);
  });

  it('取消后可以开始独立的新请求', () => {
    const gate = new CanvasResourceOpenGate();
    const first = gate.begin('notebook-a');
    gate.cancel();
    const next = gate.begin('notebook-b');

    expect(gate.isCurrent(first, 'notebook-b')).toBe(false);
    expect(gate.isCurrent(next, 'notebook-b')).toBe(true);
  });

  it('Notebook 已切换但 effect 尚未取消时也拒绝旧响应', () => {
    const gate = new CanvasResourceOpenGate();
    const request = gate.begin('notebook-a');

    expect(request.signal.aborted).toBe(false);
    expect(gate.isCurrent(request, 'notebook-b')).toBe(false);
  });
});
