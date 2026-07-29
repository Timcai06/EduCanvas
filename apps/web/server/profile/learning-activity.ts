import type {
  LearningActivity,
  LearningActivityDay,
} from '@/features/profile/activity-contract';

/**
 * 学习档案的活动派生（纯函数，可单测）。类型走契约（activity-contract）单一真源。
 *
 * 把仓储返回的可信判分事件时间戳折算成按天计数、连续天数和窗口内活跃天数。
 * 本文件不触库，也不推断或伪造学习事实。
 *
 * 日期口径：生产默认教学时区 Asia/Shanghai，与 progress-drawer 一致。
 * 所有日历日运算基于 IANA 时区 + Intl.DateTimeFormat，不依赖 Node 进程本地时区，
 * 不使用固定 86_400_000 毫秒进行日历日加减。
 */

const WINDOW_DAYS = 53 * 7; // 371 天
const DEFAULT_TIME_ZONE = 'Asia/Shanghai';

/** 将任意 ISO instant 转换为指定 IANA 时区下的 YYYY-MM-DD 日期键。 */
function toDateKey(instant: Date, timeZone: string): string {
  // Intl.DateTimeFormat 的 formatToParts 在目标时区中分解日历字段
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);

  const year = parts.find((p) => p.type === 'year')!.value;
  const month = parts.find((p) => p.type === 'month')!.value;
  const day = parts.find((p) => p.type === 'day')!.value;
  return `${year}-${month}-${day}`;
}

/** 获取指定时区中「今天」的 YYYY-MM-DD 日期键。 */
function todayKey(now: Date, timeZone: string): string {
  return toDateKey(now, timeZone);
}

/**
 * 日历日前移 n 天：基于 UTC 日期字段加减，不经过本地时区转换。
 * 输入是 YYYY-MM-DD 字符串，输出也是 YYYY-MM-DD 字符串。
 * 这避免了固定毫秒在夏令时切换日的错位问题。
 */
function addCalendarDays(dateKeyStr: string, delta: number): string {
  // 解析为 UTC 午夜，用 setUTCDate 做日历日加减（UTC 无夏令时）
  const [y, m, d] = dateKeyStr.split('-').map(Number) as [number, number, number];
  const utc = new Date(Date.UTC(y, m - 1, d));
  utc.setUTCDate(utc.getUTCDate() + delta);
  const yy = String(utc.getUTCFullYear());
  const mm = String(utc.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(utc.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/** 构建覆盖热力图窗口、以 today 结尾的每日计数（按 perDay 填充，其余为 0）。 */
function buildWindow(
  perDay: Map<string, number>,
  today: string,
): LearningActivityDay[] {
  const days: LearningActivityDay[] = [];
  for (let offset = -(WINDOW_DAYS - 1); offset <= 0; offset += 1) {
    const key = addCalendarDays(today, offset);
    days.push({ date: key, count: perDay.get(key) ?? 0 });
  }
  return days;
}

/**
 * 连续天数：从今天往回走，遇到第一个无活动日即停；允许今天尚未学习（从昨天算起）。
 * 只看窗口内的天，够热力图与档案展示。
 */
function currentStreak(perDay: Map<string, number>, today: string): number {
  let streak = 0;
  let cursor = today;
  if (!perDay.has(cursor)) cursor = addCalendarDays(today, -1);
  while (perDay.has(cursor)) {
    streak += 1;
    cursor = addCalendarDays(cursor, -1);
  }
  return streak;
}

export function buildLearningActivity(input: {
  sessionActivityAt: readonly string[];
  masteryPercent: number | null;
  totalSessions: number;
  /** 注入「今天」便于测试；默认取当前时间。 */
  now?: Date;
  /** 注入教学时区便于测试；默认 Asia/Shanghai。 */
  timeZone?: string;
}): LearningActivity {
  const tz = input.timeZone ?? DEFAULT_TIME_ZONE;
  const now = input.now ?? new Date();
  const today = todayKey(now, tz);
  const windowStartKey = addCalendarDays(today, -(WINDOW_DAYS - 1));

  const perDay = new Map<string, number>();
  for (const iso of input.sessionActivityAt) {
    const parsed = new Date(iso);
    if (Number.isNaN(parsed.getTime())) continue;
    const key = toDateKey(parsed, tz);
    // 窗口外或未来事件忽略
    if (key < windowStartKey || key > today) continue;
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
