import { describe, expect, it } from 'vitest';
import { buildLearningActivity } from './learning-activity';

const NOW = new Date('2026-07-24T09:00:00+08:00');

function isoDaysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 86_400_000).toISOString();
}

describe('buildLearningActivity', () => {
  it('覆盖 53 周整窗，无活动时全为 0', () => {
    const activity = buildLearningActivity({
      sessionActivityAt: [],
      masteryPercent: null,
      totalSessions: 0,
      now: NOW,
    });
    expect(activity.days).toHaveLength(53 * 7);
    expect(activity.activeDays).toBe(0);
    expect(activity.streakDays).toBe(0);
    expect(activity.days.every((day) => day.count === 0)).toBe(true);
    // 最后一格是今天
    expect(activity.days.at(-1)?.date).toBe('2026-07-24');
  });

  it('同一天多次会话累加为该天的 count', () => {
    const activity = buildLearningActivity({
      sessionActivityAt: [isoDaysAgo(0), isoDaysAgo(0), isoDaysAgo(0)],
      masteryPercent: 60,
      totalSessions: 3,
      now: NOW,
    });
    expect(activity.days.at(-1)?.count).toBe(3);
    expect(activity.activeDays).toBe(1);
    expect(activity.masteryPercent).toBe(60);
  });

  it('连续天数从今天往回数，遇断即停', () => {
    const activity = buildLearningActivity({
      sessionActivityAt: [isoDaysAgo(0), isoDaysAgo(1), isoDaysAgo(2)],
      masteryPercent: null,
      totalSessions: 3,
      now: NOW,
    });
    expect(activity.streakDays).toBe(3);
  });

  it('今天未学但昨天学了，连续天数从昨天算起', () => {
    const activity = buildLearningActivity({
      sessionActivityAt: [isoDaysAgo(1), isoDaysAgo(2)],
      masteryPercent: null,
      totalSessions: 2,
      now: NOW,
    });
    expect(activity.streakDays).toBe(2);
  });

  it('最近活跃早于昨天则连续天数断为 0', () => {
    const activity = buildLearningActivity({
      sessionActivityAt: [isoDaysAgo(3), isoDaysAgo(4)],
      masteryPercent: null,
      totalSessions: 2,
      now: NOW,
    });
    expect(activity.streakDays).toBe(0);
    expect(activity.activeDays).toBe(2);
  });

  it('忽略窗口外与未来事件，避免活跃天数和热力图口径漂移', () => {
    const activity = buildLearningActivity({
      sessionActivityAt: [
        isoDaysAgo(0),
        isoDaysAgo(53 * 7),
        new Date(NOW.getTime() + 86_400_000).toISOString(),
      ],
      masteryPercent: null,
      totalSessions: 1,
      now: NOW,
    });
    expect(activity.activeDays).toBe(1);
    expect(activity.days.reduce((sum, day) => sum + day.count, 0)).toBe(1);
  });
});
