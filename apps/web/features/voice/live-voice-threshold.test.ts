import { describe, expect, it } from 'vitest';
import {
  computeFlyDelta,
  reduceLiveVoiceThreshold,
  type LiveVoiceThresholdEvent,
  type LiveVoiceThresholdPhase,
} from './live-voice-threshold';

describe('reduceLiveVoiceThreshold', () => {
  it('走通完整环路 desk→entering→voice→exiting→desk', () => {
    let phase: LiveVoiceThresholdPhase = 'desk';
    phase = reduceLiveVoiceThreshold(phase, 'ENTER');
    expect(phase).toBe('entering');
    phase = reduceLiveVoiceThreshold(phase, 'ENTERED');
    expect(phase).toBe('voice');
    phase = reduceLiveVoiceThreshold(phase, 'EXIT');
    expect(phase).toBe('exiting');
    phase = reduceLiveVoiceThreshold(phase, 'EXITED');
    expect(phase).toBe('desk');
  });

  it('entering 期间取消直接退回 desk（桌面不留半成品）', () => {
    const entering = reduceLiveVoiceThreshold('desk', 'ENTER');
    expect(reduceLiveVoiceThreshold(entering, 'EXIT')).toBe('desk');
  });

  it('entering 失败原路退回 desk', () => {
    const entering = reduceLiveVoiceThreshold('desk', 'ENTER');
    expect(reduceLiveVoiceThreshold(entering, 'ENTER_FAILED')).toBe('desk');
  });

  it('非法迁移保持原相位（settled 守卫）', () => {
    const illegal: ReadonlyArray<
      readonly [LiveVoiceThresholdPhase, LiveVoiceThresholdEvent]
    > = [
      ['desk', 'ENTERED'],
      ['desk', 'EXIT'],
      ['desk', 'EXITED'],
      ['entering', 'EXITED'],
      ['voice', 'ENTER'],
      ['voice', 'ENTERED'],
      ['voice', 'EXITED'],
      ['exiting', 'ENTER'],
      ['exiting', 'EXIT'],
    ];
    for (const [phase, event] of illegal) {
      expect(reduceLiveVoiceThreshold(phase, event)).toBe(phase);
    }
  });
});

describe('computeFlyDelta', () => {
  it('返回捕获矩形中心到目标矩形中心的位移', () => {
    const captured = { x: 100, y: 200, width: 40, height: 40 };
    const target = { x: 300, y: 100, width: 80, height: 80 };
    // captured 中心 (120,220)，target 中心 (340,140)
    expect(computeFlyDelta(captured, target)).toEqual({ dx: -220, dy: 80 });
  });

  it('中心重合时位移为零', () => {
    const a = { x: 0, y: 0, width: 50, height: 50 };
    const b = { x: 100, y: 100, width: 50, height: 50 };
    expect(computeFlyDelta(a, b)).toEqual({ dx: -100, dy: -100 });
    expect(computeFlyDelta(a, a)).toEqual({ dx: 0, dy: 0 });
  });
});
