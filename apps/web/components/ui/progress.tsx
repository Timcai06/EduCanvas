'use client';

import type { HTMLAttributes } from 'react';

/*
 * 进度条（Progress）：确定的 0..max 进度，消费墨紫 token；宽度过渡交给 CSS,
 * reduced-motion 免过渡。角色 progressbar 由读屏朗读当前值；value 越界钳制到 0..max。
 * 不确定态（indeterminate）目前用不到，此处只做确定态以保持语义最简。
 */
interface ProgressProps extends Omit<HTMLAttributes<HTMLDivElement>, 'value'> {
  /** 当前进度，0..max，越界自动钳制。 */
  value?: number;
  /** 最大值，默认为 100。 */
  max?: number;
  /** 读屏标签（无可见文本时必填）。 */
  label?: string;
}

export function Progress({
  value = 0,
  max = 100,
  label,
  className = '',
  ...rest
}: ProgressProps) {
  const safeMax = max > 0 ? max : 100;
  const pct = Math.max(0, Math.min(100, (value / safeMax) * 100));
  return (
    <div
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={safeMax}
      aria-label={label}
      className={`h-2 w-full overflow-hidden rounded-full bg-surface-strong ${className}`}
      {...rest}
    >
      <div
        className="h-full rounded-full bg-accent transition-[width] ease-out motion-reduce:transition-none"
        style={{
          width: `${pct}%`,
          transitionDuration: 'var(--duration-standard)',
        }}
      />
    </div>
  );
}

export default Progress;
