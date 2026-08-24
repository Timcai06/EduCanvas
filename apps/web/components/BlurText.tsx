'use client';

import { motion, type Transition } from 'motion/react';
import { useEffect, useMemo, useRef, useState, type ElementType } from 'react';
import { useReducedMotion } from '@/features/workspace/shared/use-reduced-motion';

/**
 * BlurText：柔焦落字（React Bits 适配版）。
 *
 * 与原版不同，这里补两件事：
 * 1. `as` 标签渲染——由调用方决定 h1/h2/p 等语义，避免把标题降级成 `<p>`；
 * 2. `prefers-reduced-motion` 下直接静态渲染，不做 blur/y 位移（项目统一走
 *    useReducedMotion：SSR/水合首帧视为 reduce，杜绝减少动态用户闪一下动画）。
 *
 * 文字样式（字体/颜色/行高）全部由调用方经 className 注入，符合「两支笔」规范，
 * 组件内不散写任何视觉值。
 */
export function BlurText({
  text = '',
  as: Tag = 'p',
  className = '',
  delay = 0.2,
  animateBy = 'words',
  direction = 'top',
  threshold = 0.1,
  rootMargin = '0px',
  stepDuration = 0.35,
  onAnimationComplete,
}: {
  text?: string;
  as?: ElementType;
  className?: string;
  delay?: number;
  animateBy?: 'words' | 'letters';
  direction?: 'top' | 'bottom';
  threshold?: number;
  rootMargin?: string;
  stepDuration?: number;
  onAnimationComplete?: () => void;
}) {
  const reducedMotion = useReducedMotion();
  const elements = animateBy === 'words' ? text.split(' ') : text.split('');
  const [inView, setInView] = useState(false);
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    if (reducedMotion || !ref.current) return;
    const node = ref.current as Element;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry?.isIntersecting) {
          setInView(true);
          observer.unobserve(node);
        }
      },
      { threshold, rootMargin },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [reducedMotion, threshold, rootMargin]);

  const fromSnapshot = useMemo<Record<string, string | number>>(
    () =>
      direction === 'top'
        ? { filter: 'blur(10px)', opacity: 0, y: -50 }
        : { filter: 'blur(10px)', opacity: 0, y: 50 },
    [direction],
  );
  const toSnapshots = useMemo<Array<Record<string, string | number>>>(
    () => [
      {
        filter: 'blur(5px)',
        opacity: 0.5,
        y: direction === 'top' ? 5 : -5,
      },
      { filter: 'blur(0px)', opacity: 1, y: 0 },
    ],
    [direction],
  );

  const stepCount = toSnapshots.length + 1;
  const totalDuration = stepDuration * (stepCount - 1);
  const times = Array.from({ length: stepCount }, (_, i) =>
    stepCount === 1 ? 0 : i / (stepCount - 1),
  );
  // 逐属性关键帧（motion 格式）：filter/opacity/y 各自是 [from, ...steps] 数组（blur 10→5→0）。
  const animateKeyframes = useMemo(() => {
    const keys = new Set<string>([
      ...Object.keys(fromSnapshot),
      ...toSnapshots.flatMap((step) => Object.keys(step)),
    ]);
    const keyframes: Record<string, Array<string | number>> = {};
    keys.forEach((k) => {
      keyframes[k] = [fromSnapshot[k]!, ...toSnapshots.map((step) => step[k]!)];
    });
    return keyframes;
  }, [fromSnapshot, toSnapshots]);

  // 减少动态：整段直接渲染，交给 CSS/reduced-motion 语义，不做逐字逐词动画。
  if (reducedMotion) {
    return <Tag className={className}>{text}</Tag>;
  }

  return (
    <Tag
      ref={ref}
      className={className}
      style={{ display: 'flex', flexWrap: 'wrap' }}
    >
      {elements.map((segment, index) => {
        const transition: Transition = {
          duration: totalDuration,
          times,
          delay: (index * delay) / 1000,
          ease: (t: number) => t,
        };
        return (
          <motion.span
            key={index}
            initial={fromSnapshot}
            animate={inView ? animateKeyframes : fromSnapshot}
            transition={transition}
            onAnimationComplete={
              index === elements.length - 1 ? onAnimationComplete : undefined
            }
            style={{
              display: 'inline-block',
              willChange: 'transform, filter, opacity',
            }}
          >
            {segment === ' ' ? '\u00A0' : segment}
            {animateBy === 'words' && index < elements.length - 1
              ? '\u00A0'
              : null}
          </motion.span>
        );
      })}
    </Tag>
  );
}

export default BlurText;
