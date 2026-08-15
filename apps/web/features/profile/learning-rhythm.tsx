import type { LearningActivityDay } from './activity-contract';

function groupIntoWeeks(days: readonly LearningActivityDay[]) {
  const recent = days.slice(-84);
  const weeks: { count: number; activeDays: number }[] = [];
  for (let index = 0; index < recent.length; index += 7) {
    const week = recent.slice(index, index + 7);
    weeks.push({
      count: week.reduce((sum, day) => sum + day.count, 0),
      activeDays: week.filter((day) => day.count > 0).length,
    });
  }
  return weeks;
}

/** 只投影可信判分事件；柱高按当前主体最近十二周相对峰值归一化。 */
export function LearningRhythm({
  days,
}: {
  days: readonly LearningActivityDay[];
}) {
  const weeks = groupIntoWeeks(days);
  const maxWeek = Math.max(1, ...weeks.map((week) => week.count));
  const recent28 = days.slice(-28);
  const recentCount = recent28.reduce((sum, day) => sum + day.count, 0);
  const recentActiveDays = recent28.filter((day) => day.count > 0).length;
  const activeRecords = days
    .filter((day) => day.count > 0)
    .slice(-5)
    .reverse();
  const peak = days.reduce<LearningActivityDay | null>(
    (best, day) => (!best || day.count > best.count ? day : best),
    null,
  );

  return (
    <section className="rounded-3xl border border-line bg-card p-4 shadow-float sm:p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-accent">
            Rhythm
          </p>
          <h2 className="mt-1 font-display text-lg font-semibold">学习节奏</h2>
        </div>
        <span className="rounded-full border border-line bg-surface px-3 py-1 text-[11px] text-ink-muted">
          最近 12 周
        </span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-2xl border border-line/70 bg-surface/55 p-2.5">
          <strong className="font-display text-2xl tabular-nums text-ink">
            {recentCount}
          </strong>
          <span className="mt-1 block text-[11px] text-ink-muted">
            近 28 天判分练习
          </span>
        </div>
        <div className="rounded-2xl border border-line/70 bg-surface/55 p-2.5">
          <strong className="font-display text-2xl tabular-nums text-ink">
            {recentActiveDays}
          </strong>
          <span className="mt-1 block text-[11px] text-ink-muted">
            近 28 天活跃日
          </span>
        </div>
      </div>

      <div
        className="mt-3 flex h-16 items-end gap-1.5 rounded-2xl border border-line/70 bg-surface/40 px-3 pb-2 pt-3"
        aria-label="最近十二周判分练习柱状图"
      >
        {weeks.map((week, index) => (
          <span
            key={index}
            title={`第 ${index + 1} 周：${week.count} 次判分练习，${week.activeDays} 个活跃日`}
            className="min-h-1 flex-1 rounded-sm bg-accent/75"
            style={{ height: `${Math.max(5, (week.count / maxWeek) * 100)}%` }}
          />
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-[10px] text-ink-faint">
        <span>12 周前</span>
        <span>
          峰值 {peak?.count ?? 0} 次{peak?.count ? ` · ${peak.date}` : ''}
        </span>
        <span>本周</span>
      </div>

      <div className="mt-3 border-t border-line/70 pt-3">
        <p className="text-xs font-semibold text-ink">最近学习记录</p>
        {activeRecords.length > 0 ? (
          <ol className="mt-1.5 space-y-1.5">
            {activeRecords.map((day) => (
              <li
                key={day.date}
                className="flex items-center justify-between text-xs"
              >
                <span className="flex items-center gap-2 text-ink-muted">
                  <i
                    className="size-1.5 rounded-full bg-accent"
                    aria-hidden="true"
                  />
                  {day.date}
                </span>
                <strong className="font-medium tabular-nums text-ink">
                  {day.count} 次
                </strong>
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-2 text-xs leading-5 text-ink-muted">
            第一笔判分练习完成后，这里会形成你的近期学习轨迹。
          </p>
        )}
      </div>
    </section>
  );
}
