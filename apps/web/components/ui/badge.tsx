'use client';

import type { HTMLAttributes, ReactNode } from 'react';

/*
 * 状态语义徽章（Badge）：neutral/accent/cinnabar/good/warn/bad。
 * 只消费 globals.css 语义 token；色弱环境下仍由文本承载语义（不单靠颜色）。
 */
const VARIANTS: Record<NonNullable<BadgeProps['variant']>, string> = {
  neutral: 'border-line bg-surface text-ink-muted',
  accent: 'border-accent/30 bg-accent-soft text-accent-strong',
  cinnabar: 'border-cinnabar/30 bg-cinnabar-soft text-cinnabar-strong',
  good: 'border-good/30 bg-good-soft text-good',
  warn: 'border-warn/30 bg-warn-soft text-warn',
  bad: 'border-bad/30 bg-bad-soft text-bad',
};

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: 'neutral' | 'accent' | 'cinnabar' | 'good' | 'warn' | 'bad';
  children?: ReactNode;
}

export function Badge({
  variant = 'neutral',
  className = '',
  children,
  ...rest
}: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium ${VARIANTS[variant]} ${className}`}
      {...rest}
    >
      {children}
    </span>
  );
}

export default Badge;
