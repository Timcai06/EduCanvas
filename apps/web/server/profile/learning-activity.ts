import type {
  LearningActivity,
  LearningActivityDay,
} from '@/features/profile/activity-contract';

/**
 * 学习档案的活动派生（纯函数，可单测）。类型走契约（activity-contract）单一真源。
 *
 * 把仓储返回的可信判分事件时间戳折算成按天计数、连续天数和窗口内活跃天数。
 * 本文件不触库，也不推断或伪造学习事实。
 */

const DAY_MS = 86_400_000;
const WINDOW_DAYS = 53 * 7;

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function atLocalMidnight(value: string): Date | null {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  parsed.setHours(0, 0, 0, 0);
  return parsed;
}

/** 构建覆盖热力图窗口、以 today 结尾的每日计数（按 perDay 填充，其余为 0）。 */
function buildWindow(
  perDay: Map<string, number>,
  today: Date,
): LearningActivityDay[] {
  const days: LearningActivityDay[] = [];
  for (let offset = WINDOW_DAYS - 1; offset >= 0; offset -= 1) {
    const date = new Date(today.getTime() - offset * DAY_MS);
    const key = dayKey(date);
    days.push({ date: key, count: perDay.get(key) ?? 0 });
  }
  return days;
}

/**
 * 连续天数：从今天往回走，遇到第一个无活动日即停；允许今天尚未学习（从昨天算起）。
 * 只看窗口内的天，够热力图与档案展示。
 */
function currentStreak(perDay: Map<string, number>, today: Date): number {
  let streak = 0;
  let cursor = new Date(today);
  if (!perDay.has(dayKey(cursor))) cursor = new Date(today.getTime() - DAY_MS);
  while (perDay.has(dayKey(cursor))) {
    streak += 1;
    cursor = new Date(cursor.getTime() - DAY_MS);
  }
  return streak;
}

export function buildLearningActivity(input: {
  sessionActivityAt: readonly string[];
  masteryPercent: number | null;
  totalSessions: number;
  /** 注入「今天」便于测试；默认取当前本地日。 */
  now?: Date;
}): LearningActivity {
  const today = input.now ? new Date(input.now) : new Date();
  today.setHours(0, 0, 0, 0);
  const windowStart = new Date(today.getTime() - (WINDOW_DAYS - 1) * DAY_MS);

  const perDay = new Map<string, number>();
  for (const iso of input.sessionActivityAt) {
    const midnight = atLocalMidnight(iso);
    if (!midnight || midnight < windowStart || midnight > today) continue;
    const key = dayKey(midnight);
    perDay.set(key, (perDay.get(key) ?? 0) + 1);
  }

  return {
    days: buildWindow(perDay, today),
    totalSessions: input.totalSessions,
    activeDays: perDay.size,
    streakDays: currentStreak(perDay, today),
    masteryPercent: input.masteryPercent,
  };
}
