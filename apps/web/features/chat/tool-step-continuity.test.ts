import { describe, expect, it } from 'vitest';
import type { MessageToolStep } from './messages';
import { reconcileToolSteps } from './tool-step-continuity';

describe('reconcileToolSteps', () => {
  it('preserves arrival order and ignores duplicate starts', () => {
    const first = reconcileToolSteps([], {
      type: 'tool.started',
      toolCallId: 'tool-1',
      label: '正在搜索资料',
    });
    const second = reconcileToolSteps(first, {
      type: 'tool.started',
      toolCallId: 'tool-2',
      label: '正在读取网页',
    });
    expect(second.map((step) => step.id)).toEqual(['tool-1', 'tool-2']);
    expect(
      reconcileToolSteps(second, {
        type: 'tool.started',
        toolCallId: 'tool-1',
        label: '重复事件',
      }),
    ).toBe(second);
  });

  it('does not invent a terminal step without a matching start', () => {
    const before: readonly MessageToolStep[] = [];
    expect(
      reconcileToolSteps(before, {
        type: 'tool.completed',
        toolCallId: 'unknown',
      }),
    ).toBe(before);
  });

  it('keeps failed terminal when a completed event arrives late', () => {
    const failed: readonly MessageToolStep[] = [
      { id: 'tool-1', label: '正在搜索资料', status: 'failed' },
    ];
    expect(
      reconcileToolSteps(failed, {
        type: 'tool.completed',
        toolCallId: 'tool-1',
      }),
    ).toBe(failed);
  });
});
