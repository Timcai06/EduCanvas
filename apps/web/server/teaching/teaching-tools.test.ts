import { describe, expect, it, vi } from 'vitest';
import {
  createTeachingToolKernelAdapters,
  teachingToolAdapterCapabilities,
  teachingToolCapabilitiesForState,
} from './teaching-tools';

vi.mock('server-only', () => ({}));

describe('Web Teaching Tool Adapter 能力事实', () => {
  it('能力上界与当前实际注册的 Adapter 精确一致且稳定排序', () => {
    const adapterCapabilities = createTeachingToolKernelAdapters().map(
      (adapter) => adapter.capability,
    );

    expect(teachingToolAdapterCapabilities()).toEqual(
      [...new Set(adapterCapabilities)].sort(),
    );
    expect(teachingToolAdapterCapabilities()).toEqual([
      'education.knowledge.retrieve',
      'education.student_state.read',
    ]);
  });

  it('教学状态白名单只能收窄实际 Adapter 能力上界', () => {
    const available = new Set(teachingToolAdapterCapabilities());

    for (const state of [
      'DIAGNOSE',
      'EXPLAIN',
      'DEMONSTRATE',
      'PRACTICE',
      'ASSESS',
    ] as const) {
      expect(
        teachingToolCapabilitiesForState(state).every((capability) =>
          available.has(capability),
        ),
      ).toBe(true);
    }
  });
});
