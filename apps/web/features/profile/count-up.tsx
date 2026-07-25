'use client';

import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { useRef } from 'react';

/**
 * 数字滚动上数（灵感来源：React Bits「CountUp」，用 GSAP 实现）。挂载时从 0 滚到 value，
 * 整数取整、tabular-nums 防抖动。reduced-motion 下直接显示终值不动画。value 为 null 时显示占位。
 */
export function CountUp({
  value,
  className,
}: {
  value: number | null;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);

  useGSAP(
    () => {
      const node = ref.current;
      if (!node || value === null) return;
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        node.textContent = String(value);
        return;
      }
      const counter = { n: 0 };
      gsap.to(counter, {
        n: value,
        duration: 1.1,
        ease: 'power2.out',
        onUpdate: () => {
          node.textContent = String(Math.round(counter.n));
        },
      });
    },
    { dependencies: [value] },
  );

  return (
    <span ref={ref} className={className}>
      {value ?? '—'}
    </span>
  );
}
