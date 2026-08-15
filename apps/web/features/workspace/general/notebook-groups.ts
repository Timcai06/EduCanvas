/**
 * 笔记本列表的「时间近度」分组。侧栏原本是一条扁平的编号列表，笔记本一多就没有查找
 * 锚点；按最近活跃时间分桶（今天/昨天/过去 7 天/过去 30 天/更早）是唯一无需触碰数据库
 * 或接口契约就能落地的分类维度——数据现成（lastActivityAt），也与主流对话侧栏一致。
 *
 * 纯函数、无副作用，边界基于「本地日历日」计算，便于随组件时区口径（zh-CN 本地时间）
 * 保持一致，并可被单元测试固定 now 精确断言。
 */
export interface NotebookListItem {
  id: string;
  title: string | null;
  lastActivityAt: string;
}

export type NotebookGroupKey =
  'today' | 'yesterday' | 'prev7' | 'prev30' | 'older';

export interface NotebookGroup {
  key: NotebookGroupKey;
  label: string;
  items: readonly NotebookListItem[];
}

const GROUP_ORDER: readonly { key: NotebookGroupKey; label: string }[] = [
  { key: 'today', label: '今天' },
  { key: 'yesterday', label: '昨天' },
  { key: 'prev7', label: '过去 7 天' },
  { key: 'prev30', label: '过去 30 天' },
  { key: 'older', label: '更早' },
];

const DAY_MS = 86_400_000;

export function formatNotebookActivityTime(
  iso: string,
  now = new Date(),
): string {
  const date = new Date(iso);
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
    });
  }
  return date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}

/** 本地时区当日零点的毫秒时间戳，用于按整日差分桶而不受具体时刻影响。 */
function startOfLocalDay(date: Date): number {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  ).getTime();
}

function bucketFor(dayDiff: number): NotebookGroupKey {
  if (dayDiff <= 0) return 'today'; // 未来时间戳（时钟偏差）归入今天，避免落空
  if (dayDiff === 1) return 'yesterday';
  if (dayDiff <= 7) return 'prev7';
  if (dayDiff <= 30) return 'prev30';
  return 'older';
}

/**
 * 把笔记本按最近活跃时间分入有序时间桶，只返回非空桶，桶内按 lastActivityAt 倒序。
 * @param items 笔记本公开投影列表（顺序不限，函数内部会自行倒序）
 * @param now 参考时刻，通常是渲染当下的 new Date()
 */
export function groupNotebooksByRecency(
  items: readonly NotebookListItem[],
  now: Date,
): readonly NotebookGroup[] {
  const nowMidnight = startOfLocalDay(now);
  const buckets: Record<NotebookGroupKey, NotebookListItem[]> = {
    today: [],
    yesterday: [],
    prev7: [],
    prev30: [],
    older: [],
  };

  const sorted = [...items].sort(
    (a, b) =>
      new Date(b.lastActivityAt).getTime() -
      new Date(a.lastActivityAt).getTime(),
  );

  for (const item of sorted) {
    const dayDiff = Math.round(
      (nowMidnight - startOfLocalDay(new Date(item.lastActivityAt))) / DAY_MS,
    );
    buckets[bucketFor(dayDiff)].push(item);
  }

  return GROUP_ORDER.filter(({ key }) => buckets[key].length > 0).map(
    ({ key, label }) => ({ key, label, items: buckets[key] }),
  );
}
