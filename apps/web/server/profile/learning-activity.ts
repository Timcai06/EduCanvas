import type {
  LearningActivity,
  LearningActivityDay,
} from '@/features/profile/activity-contract';

/**
 * 学习档案的活动派生（纯函数，可单测）。类型走契约（activity-contract）单一真源。
 *
 * 正式实现：把学习活动的时间戳（`sessionActivityAt`）折算成按天计数 + 连续天数 + 活跃天数。
 * 当前上层服务喂的是 mock 时间戳（见 learning-activity-service），接口/链路为正式；接入真实
 * 按天事件时只需替换喂给本函数的时间戳来源，本文件的窗口与连续天数逻辑无需改动。不触库。
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

  const perDay = new Map<string, number>();
  for (const iso of input.sessionActivityAt) {
    const midnight = atLocalMidnight(iso);
    if (!midnight) continue;
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

/* ---------- mock 数据源（纯函数，可单测）---------- *
 * 按 seed 确定性伪造一年学习活动，喂给上面的正式派生。接入真实按天事件时删除此段即可。
 * 与服务层分离是为了让 mock 逻辑不背 `server-only`、可在 vitest 里直接测。 */

/** FNV-1a：把 seed 折成 32 位无符号整数作为 PRNG 种子。 */
function hashSeed(seed: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** mulberry32：确定性 PRNG，保证同一主体每次得到一致的 mock，避免热力图闪烁。 */
function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildMockLearningActivity(
  seed: string,
  now: Date = new Date(),
): LearningActivity {
  const random = mulberry32(hashSeed(seed));
  const sessionCount = 90 + Math.floor(random() * 80);
  const sessionActivityAt: string[] = [];
  for (let i = 0; i < sessionCount; i += 1) {
    const bias = random() ** 1.7; // 偏向小 offset → 近期更活跃
    const offset = Math.min(WINDOW_DAYS - 1, Math.floor(bias * WINDOW_DAYS));
    const at = new Date(now.getTime() - offset * DAY_MS);
    at.setHours(9 + Math.floor(random() * 10), Math.floor(random() * 60), 0, 0);
    sessionActivityAt.push(at.toISOString());
  }
  const masteryPercent = 55 + Math.floor(random() * 31); // 55–85
  return buildLearningActivity({
    sessionActivityAt,
    masteryPercent,
    totalSessions: sessionCount,
    now,
  });
}
