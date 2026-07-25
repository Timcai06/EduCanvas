'use client';

import { CountUp } from './count-up';
import { SpotlightCard } from './spotlight-card';

/**
 * 档案统计四联（炫技集合：CountUp 上数 + SpotlightCard 跟随光斑 + 悬停微浮）。
 * 数据来自服务端页面，此处只做展示与交互。
 */
export function ProfileStats({
  streakDays,
  totalSessions,
  masteryPercent,
  activeDays,
}: {
  streakDays: number;
  totalSessions: number;
  masteryPercent: number | null;
  activeDays: number;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Tile value={streakDays} unit="天" label="连续学习" hot />
      <Tile value={totalSessions} label="学习课次" />
      <Tile value={masteryPercent} unit="%" label="平均掌握度" />
      <Tile value={activeDays} unit="天" label="近一年活跃" />
    </div>
  );
}

function Tile({
  value,
  unit,
  label,
  hot = false,
}: {
  value: number | null;
  unit?: string;
  label: string;
  hot?: boolean;
}) {
  return (
    <SpotlightCard className="rounded-2xl border border-line bg-card px-4 py-3.5 transition-transform duration-300 hover:-translate-y-0.5">
      <p
        className={`font-display text-2xl font-semibold leading-none tabular-nums ${hot ? 'text-accent' : 'text-ink'}`}
      >
        <CountUp value={value} />
        {unit && value !== null ? (
          <span className="ml-0.5 text-base text-ink-muted">{unit}</span>
        ) : null}
      </p>
      <p className="mt-2 text-xs text-ink-muted">{label}</p>
    </SpotlightCard>
  );
}
