'use client';

import { useRef } from 'react';

/**
 * 跟随鼠标的墨紫光斑卡片（灵感来源：React Bits「SpotlightCard」）。onMouseMove 把光斑位置写入
 * CSS 变量 --spot-x/--spot-y，柔光由 .spotlight-card::before 渲染（见 globals.css）。
 * 纯指针交互，无动画帧循环；触屏无 hover 自然降级为普通卡片。
 */
export function SpotlightCard({
  className = '',
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  const onMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
    const node = ref.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    node.style.setProperty('--spot-x', `${event.clientX - rect.left}px`);
    node.style.setProperty('--spot-y', `${event.clientY - rect.top}px`);
  };

  return (
    <div
      ref={ref}
      onMouseMove={onMouseMove}
      className={`spotlight-card ${className}`}
    >
      {children}
    </div>
  );
}
