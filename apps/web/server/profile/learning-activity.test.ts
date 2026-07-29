import { describe, expect, it } from 'vitest';
import { buildLearningActivity } from './learning-activity';

/** 固定「今天」为上海时间 2026-07-24 09:00 */
const NOW = new Date('2026-07-24T09:00:00+08:00');

function isoDaysAgo(days: number): string {
  // 用日历日而非固定毫秒：基于 UTC 日期偏移
  const base = new Date('2026-07-24T00:00:00Z');
  base.setUTCDate(base.getUTCDate() - days);
  return base.toISOString();
}

describe('buildLearningActivity', () => {
  it('覆盖 53 周整窗（371 天），无活动时全为 0', () => {
    const activity = buildLearningActivity({
      sessionActivityAt: [],
      masteryPercent: null,
      totalSessions: 0,
      now: NOW,
    });
    expect(activity.days).toHaveLength(371);
    expect(activity.activeDays).toBe(0);
    expect(activity.streakDays).toBe(0);
    expect(activity.days.every((day) => day.count === 0)).toBe(true);
    // 最后一格是教学时区的今天
    expect(activity.days.at(-1)?.date).toBe('2026-07-24');
  });

  it('371 个日期键互不重复且严格升序', () => {
    const activity = buildLearningActivity({
      sessionActivityAt: [],
      masteryPercent: null,
      totalSessions: 0,
      now: NOW,
    });
    const keys = activity.days.map((d) => d.date);
    const unique = new Set(keys);
    expect(unique.size).toBe(371);
    for (let i = 1; i < keys.length; i += 1) {
      expect(keys[i]! > keys[i - 1]!).toBe(true);
    }
  });

  it('同一天多次会话累加为该天的 count，不增加 activeDays', () => {
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

  it('忽略窗口外与未来事件', () => {
    const activity = buildLearningActivity({
      sessionActivityAt: [
        isoDaysAgo(0),
        isoDaysAgo(371), // 窗口外
        new Date(NOW.getTime() + 86_400_000).toISOString(), // 未来
      ],
      masteryPercent: null,
      totalSessions: 1,
      now: NOW,
    });
    expect(activity.activeDays).toBe(1);
    expect(activity.days.reduce((sum, day) => sum + day.count, 0)).toBe(1);
  });

  // ========== P01 新增：教学时区日历日边界 ==========

  describe('教学时区（Asia/Shanghai）日历日边界', () => {
    it('上海 23:59 与次日 00:01 分属不同日期键', () => {
      const activity = buildLearningActivity({
        sessionActivityAt: [
          '2026-07-23T23:59:00+08:00', // 上海 7/23
          '2026-07-24T00:01:00+08:00', // 上海 7/24
        ],
        masteryPercent: null,
        totalSessions: 2,
        now: NOW,
      });
      expect(activity.activeDays).toBe(2);
      const day23 = activity.days.find((d) => d.date === '2026-07-23');
      const day24 = activity.days.find((d) => d.date === '2026-07-24');
      expect(day23?.count).toBe(1);
      expect(day24?.count).toBe(1);
    });

    it('UTC 午夜的事件在上海时区属于同一天', () => {
      // UTC 2026-07-23T16:01:00Z = 上海 2026-07-24T00:01:00+08:00
      // UTC 2026-07-24T15:59:00Z = 上海 2026-07-24T23:59:00+08:00
      const activity = buildLearningActivity({
        sessionActivityAt: [
          '2026-07-23T16:01:00Z',
          '2026-07-24T15:59:00Z',
        ],
        masteryPercent: null,
        totalSessions: 2,
        now: NOW,
      });
      // 两个事件都在上海 7/24
      expect(activity.activeDays).toBe(1);
      expect(activity.days.at(-1)?.count).toBe(2);
    });

    it('不依赖 Node 进程本地时区：任何 TZ 下结果一致', () => {
      // 此测试在 CI 中 TZ=UTC 和 TZ=America/Los_Angeles 下都应通过
      const activity = buildLearningActivity({
        sessionActivityAt: ['2026-07-24T01:00:00+08:00'],
        masteryPercent: null,
        totalSessions: 1,
        now: NOW,
      });
      // 上海 7/24 01:00 → 日期键必须是 2026-07-24，不管进程 TZ
      expect(activity.days.at(-1)?.count).toBe(1);
      expect(activity.days.at(-1)?.date).toBe('2026-07-24');
    });
  });

  describe('夏令时边界（注入 America/New_York）', () => {
    it('春季前进（少一小时）：相邻日只产生一个日期键', () => {
      // 2026-03-08 是纽约春季 DST 切换日（2:00→3:00，少一小时）
      const nyNow = new Date('2026-03-09T10:00:00-04:00');
      const activity = buildLearningActivity({
        sessionActivityAt: [
          '2026-03-07T23:00:00-05:00', // 纽约 3/7
          '2026-03-08T00:30:00-05:00', // 纽约 3/8（DST 日）
          '2026-03-08T23:30:00-04:00', // 纽约 3/8（DST 后）
        ],
        masteryPercent: null,
        totalSessions: 3,
        now: nyNow,
        timeZone: 'America/New_York',
      });
      expect(activity.activeDays).toBe(2); // 3/7 和 3/8
      const day7 = activity.days.find((d) => d.date === '2026-03-07');
      const day8 = activity.days.find((d) => d.date === '2026-03-08');
      expect(day7?.count).toBe(1);
      expect(day8?.count).toBe(2);
    });

    it('秋季回退（多一小时）：相邻日只产生一个日期键', () => {
      // 2026-11-01 是纽约秋季 DST 切换日（2:00→1:00，多一小时）
      const nyNow = new Date('2026-11-02T10:00:00-05:00');
      const activity = buildLearningActivity({
        sessionActivityAt: [
          '2026-11-01T01:30:00-04:00', // 纽约 11/1 凌晨（DST 前）
          '2026-11-01T01:30:00-05:00', // 纽约 11/1 凌晨（DST 后，同一日历日）
        ],
        masteryPercent: null,
        totalSessions: 2,
        now: nyNow,
        timeZone: 'America/New_York',
      });
      // 两个事件都在纽约 11/1，只算一天
      expect(activity.activeDays).toBe(1);
      const day1 = activity.days.find((d) => d.date === '2026-11-01');
      expect(day1?.count).toBe(2);
    });

    it('371 个日期键在夏令时切换期间仍互不重复且严格升序', () => {
      const nyNow = new Date('2026-03-09T10:00:00-04:00');
      const activity = buildLearningActivity({
        sessionActivityAt: [],
        masteryPercent: null,
        totalSessions: 0,
        now: nyNow,
        timeZone: 'America/New_York',
      });
      const keys = activity.days.map((d) => d.date);
      expect(keys).toHaveLength(371);
      const unique = new Set(keys);
      expect(unique.size).toBe(371);
      for (let i = 1; i < keys.length; i += 1) {
        expect(keys[i]! > keys[i - 1]!).toBe(true);
      }
    });
  });
});
