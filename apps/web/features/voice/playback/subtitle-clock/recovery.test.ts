import { describe, expect, it } from 'vitest';
import { createSubtitleDurationClock } from './recovery';

describe('createSubtitleDurationClock', () => {
  it('在首段累积样本不足前保持 1:1 缩放', () => {
    const clock = createSubtitleDurationClock();
    expect(clock.getScaleFactor()).toBe(1);
    expect(clock.getScaleFactor()).toBe(1);
  });

  it('使用真实累计 PCM 时长做确定性缩放', () => {
    const clock = createSubtitleDurationClock();
    clock.observe(2.0, 1.0);
    expect(clock.getScaleFactor()).toBeLessThanOrEqual(1.8);
    clock.observe(3.0, 1.5);
    expect(clock.getScaleFactor()).toBeLessThanOrEqual(1.8);
  });

  it('缩放比例会钳制到可用区间，避免异常抖动', () => {
    const clock = createSubtitleDurationClock({ minScale: 0.8, maxScale: 1.2 });
    clock.observe(100, 1);
    expect(clock.getScaleFactor()).toBe(1.2);
    clock.reset();
    expect(clock.getScaleFactor()).toBe(1);
  });
});
