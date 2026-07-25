'use client';

import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { type CSSProperties, useCallback, useRef } from 'react';
import './CircularText.css';

type HoverBehavior = 'slowDown' | 'speedUp' | 'pause' | 'goBonkers';

export interface CircularTextProps {
  text: string;
  spinDuration?: number;
  onHover?: HoverBehavior;
  className?: string;
}

/**
 * 环形品牌文字。组件只控制排版和连续旋转，不承担导航；
 * reduced-motion 下保持静态，悬停行为不会写入全局 GSAP 状态。
 */
export function CircularText({
  text,
  spinDuration = 20,
  onHover = 'speedUp',
  className = '',
}: CircularTextProps) {
  const rootRef = useRef<HTMLSpanElement>(null);
  const spinRef = useRef<gsap.core.Tween | null>(null);
  const reducedMotionRef = useRef(false);
  const letters = Array.from(text);

  const { contextSafe } = useGSAP(
    () => {
      const root = rootRef.current;
      if (!root) return;
      const media = gsap.matchMedia();
      media.add('(prefers-reduced-motion: reduce)', () => {
        reducedMotionRef.current = true;
        gsap.set(root, { rotate: 0, scale: 1 });
      });
      media.add('(prefers-reduced-motion: no-preference)', () => {
        reducedMotionRef.current = false;
        spinRef.current = gsap.to(root, {
          rotate: '+=360',
          duration: spinDuration,
          repeat: -1,
          ease: 'none',
        });
      });
      return () => {
        spinRef.current?.kill();
        spinRef.current = null;
        media.revert();
      };
    },
    { scope: rootRef, dependencies: [spinDuration], revertOnUpdate: true },
  );

  const applyHover = useCallback(
    (active: boolean) =>
      contextSafe(() => {
        if (reducedMotionRef.current) return;
        const spin = spinRef.current;
        if (!spin) return;
        const timeScale = !active
          ? 1
          : onHover === 'slowDown'
            ? 0.45
            : onHover === 'pause'
              ? 0
              : onHover === 'goBonkers'
                ? 12
                : 4;
        gsap.to(spin, {
          timeScale,
          duration: 0.28,
          ease: 'power2.out',
          overwrite: true,
        });
        gsap.to(rootRef.current, {
          scale: active && onHover === 'goBonkers' ? 0.84 : 1,
          duration: 0.28,
          ease: 'power2.out',
          overwrite: 'auto',
        });
      })(),
    [contextSafe, onHover],
  );

  return (
    <span
      ref={rootRef}
      aria-label={text.replaceAll('*', ' ')}
      className={`circular-text${className ? ` ${className}` : ''}`}
      style={{ '--circular-count': letters.length } as CSSProperties}
      onMouseEnter={() => applyHover(true)}
      onMouseLeave={() => applyHover(false)}
    >
      {letters.map((letter, index) => (
        <span
          key={`${letter}-${index}`}
          aria-hidden="true"
          className="circular-text__letter"
          style={{ '--circular-index': index } as CSSProperties}
        >
          {letter}
        </span>
      ))}
    </span>
  );
}
