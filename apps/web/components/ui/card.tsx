'use client';

import type { HTMLAttributes, ReactNode } from 'react';

/*
 * 统一表面卡（Card/Surface）：一致的圆角/边界/墨色投影，可选 hover 抬升 + 光斑、
 * 或磨砂玻璃。只消费 token；rest 透传，可作普通 div 或搭配 button 用。
 */
export function Card({
  glass = false,
  hover = false,
  className = '',
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement> & {
  /** 磨砂玻璃表面（Apple 风，reduced-transparency 下退近实底）。 */
  glass?: boolean;
  /** hover 抬升 + 墨色投影加深。 */
  hover?: boolean;
  children?: ReactNode;
}) {
  const base =
    'rounded-2xl border border-line/70 bg-card shadow-[var(--shadow-float)]';
  const hoverCls = hover
    ? 'transition-[transform,box-shadow,border-color] hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-[var(--shadow-card-hover)]'
    : '';
  const glassCls = glass ? 'glass' : '';
  return (
    <div className={`${base} ${hoverCls} ${glassCls} ${className}`} {...rest}>
      {children}
    </div>
  );
}

export default Card;
