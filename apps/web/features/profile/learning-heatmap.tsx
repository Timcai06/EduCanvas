'use client';

import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { useRef } from 'react';
import type { LearningActivityDay } from '@/features/profile/activity-contract';

/**
 * 学习热力图：GitHub 贡献图的教学版。过去约一年、每格一天，按当天「判分事件数」取五档
 * 墨紫深浅（越学越深，count 定义见 activity-contract）。纯展示、不承载状态语义，故取色走
 * 独立的 heat 令牌而非 good/accent 语义色。档位走相对分位（见 heatLevel）。
 *
 * 直接消费服务端已排好序的 days（不自算「今天」），避免 SSR/水合的日期漂移。挂载时格子以
 * 从左到右的波浪 stagger 逐格点亮（灵感来源：GSAP 交错入场 demo）；reduced-motion 下不动画。
 */
const HEAT_CLASS = [
  'bg-heat-0',
  'bg-heat-1',
  'bg-heat-2',
  'bg-heat-3',
  'bg-heat-4',
] as const;
const WEEKDAY_LABELS = ['一', '', '三', '', '五', '', ''] as const;

/**
 * 档位走「相对分位」（GitHub 做法）：按该主体窗口内最忙的一天切四档，最忙日=L4，
 * 其余按占最大值的比例落 L1–L4。每个人的图都饱满好看；代价是跨学生不可比、含义随人漂移。
 */
function heatLevel(count: number, maxCount: number): number {
  if (count <= 0 || maxCount <= 0) return 0;
  return Math.min(4, Math.max(1, Math.ceil((count / maxCount) * 4)));
}

type Cell = { key: string; count: number; level: number } | null;

export function LearningHeatmap({
  days,
}: {
  days: readonly LearningActivityDay[];
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const maxCount = days.reduce((max, day) => Math.max(max, day.count), 0);
  const activeDays = days.filter((day) => day.count > 0).length;

  // 用固定的日期串定位星期（附 T00:00:00 走本地时区），确定性、无「今天」依赖。
  const firstWeekday = days.length
    ? (new Date(`${days[0]!.date}T00:00:00`).getDay() + 6) % 7
    : 0;
  const flat: Cell[] = [
    ...Array<Cell>(firstWeekday).fill(null),
    ...days.map((day) => ({
      key: day.date,
      count: day.count,
      level: heatLevel(day.count, maxCount),
    })),
  ];
  while (flat.length % 7 !== 0) flat.push(null);

  const columns: Cell[][] = [];
  for (let i = 0; i < flat.length; i += 7) columns.push(flat.slice(i, i + 7));

  let previousMonth = -1;
  const monthLabels = columns.map((column) => {
    const firstCell = column.find((cell): cell is NonNullable<Cell> =>
      Boolean(cell),
    );
    if (!firstCell) return null;
    const month = new Date(`${firstCell.key}T00:00:00`).getMonth();
    if (month === previousMonth) return null;
    previousMonth = month;
    return `${month + 1}月`;
  });

  useGSAP(
    () => {
      const media = gsap.matchMedia();
      media.add('(prefers-reduced-motion: no-preference)', () => {
        gsap.from(rootRef.current!.querySelectorAll('.heat-cell'), {
          autoAlpha: 0,
          scale: 0.4,
          transformOrigin: 'center',
          duration: 0.4,
          ease: 'power2.out',
          stagger: { amount: 1.1, from: 'start' },
        });
      });
    },
    { scope: rootRef },
  );

  return (
    <div ref={rootRef}>
      {/*
       * 桌面端格子铺满不溢出；窄屏溢出时隐藏滚动条（.no-scrollbar）并靠 dir=rtl 让初始
       * 位置停在最右（最近的周），对齐 GitHub 贡献图。内层 dir=ltr 保持正常从左到右布局。
       */}
      <div className="no-scrollbar overflow-x-auto pb-1" dir="rtl">
        <div className="inline-flex gap-2" dir="ltr">
          {/* 左侧星期标签，与格子行等高对齐 */}
          <div className="flex flex-col gap-[2px] pt-[18px] text-[10px] text-ink-faint">
            {WEEKDAY_LABELS.map((label, index) => (
              <span
                key={index}
                className="flex h-[10px] items-center leading-none"
              >
                {label}
              </span>
            ))}
          </div>
          <div>
            {/* 月份标签行 */}
            <div className="flex gap-[2px]">
              {monthLabels.map((label, index) => (
                <div key={index} className="relative h-4 w-[10px]">
                  {label ? (
                    <span className="pointer-events-none absolute left-0 top-0 whitespace-nowrap text-[10px] text-ink-faint">
                      {label}
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
            {/* 格子矩阵 */}
            <div className="flex gap-[2px]">
              {columns.map((column, index) => (
                <div key={index} className="flex flex-col gap-[2px]">
                  {column.map((cell, row) =>
                    cell ? (
                      <div
                        key={cell.key}
                        title={`${cell.key}：${cell.count} 次判分练习`}
                        className={`heat-cell size-[10px] rounded-[2px] ${HEAT_CLASS[cell.level]}`}
                      />
                    ) : (
                      <div
                        key={`pad-${index}-${row}`}
                        className="size-[10px]"
                      />
                    ),
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between text-xs text-ink-muted">
        <span>近一年 {activeDays} 天有学习</span>
        <span className="flex items-center gap-1.5 text-ink-faint">
          少
          {HEAT_CLASS.map((cls) => (
            <span key={cls} className={`size-[10px] rounded-[2px] ${cls}`} />
          ))}
          多
        </span>
      </div>
    </div>
  );
}
