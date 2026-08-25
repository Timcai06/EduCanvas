'use client';

import type { ButtonHTMLAttributes, ReactNode } from 'react';

/*
 * 规范化的主按钮：统一 variant/size/state（primary/secondary/ghost/danger）。
 * 只消费 globals.css 的语义 token；pressed 由 interactive-controls.css 的
 * button.bg-accent:active 提供，其余变体靠 hover 反馈。聚焦环 2px accent + 2px offset
 * 全量一致；disabled 置灰；loading 前置 spinner（reduced-motion 停转）。
 */
const VARIANTS: Record<NonNullable<ButtonProps['variant']>, string> = {
  primary:
    'bg-accent text-card hover:bg-accent-strong focus-visible:ring-accent',
  secondary:
    'border border-line bg-card text-ink hover:bg-surface focus-visible:ring-accent',
  ghost:
    'text-ink-muted hover:bg-surface hover:text-ink focus-visible:ring-accent',
  danger:
    'bg-cinnabar text-card hover:bg-cinnabar-strong focus-visible:ring-cinnabar',
};

const SIZES: Record<NonNullable<ButtonProps['size']>, string> = {
  sm: 'min-h-9 px-3.5 text-sm',
  md: 'min-h-11 px-5 text-sm',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** 视觉语义：primary=墨紫主讲；secondary=纸面次按钮；ghost=弱操作；danger=朱砂批改。 */
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
  /** 加载态：前置 spinner 并禁用点击。 */
  loading?: boolean;
  children?: ReactNode;
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  className = '',
  children,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-full font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? (
        <span
          aria-hidden="true"
          className="size-4 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none"
        />
      ) : null}
      {children}
    </button>
  );
}

export default Button;
