'use client';

import { useEffect, type RefObject } from 'react';
import Lenis from 'lenis';
import { useReducedMotion } from './use-reduced-motion';

/**
 * useLenis：把平滑滚动绑定到**某个滚动容器**（而非 window），用于学习记录/资源库等
 * 「非流式」的内部长列表。
 *
 * - 通过 `wrapper` 指向具体元素，避免劫持 window 滚动、不与工作区壳 `overflow:hidden`
 *   冲突；`content` 未指定时 lenis 用 wrapper 的 child 作为内容。
 * - `autoRaf` 让 lenis 自己管理 requestAnimationFrame，无需外部驱动。
 * - `prefers-reduced-motion` 下**不初始化**（继承 useReducedMotion 的 SSR/水合首帧 = reduce）。
 * - 卸载时 destroy，随组件生命周期正确回收。
 *
 * 注意：仅用于**非虚拟化、非流式**的列表；虚拟化容器（如资源库）与流式对话列
 * 不应开启 lenis（会与虚拟化器/自动滚底冲突）。
 */
export function useLenis(
  ref: RefObject<HTMLElement | null>,
  {
    duration = 1.0,
    smoothWheel = true,
  }: { duration?: number; smoothWheel?: boolean } = {},
): void {
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (reducedMotion) return;
    const element = ref.current;
    if (!element) return;
    const lenis = new Lenis({
      wrapper: element,
      duration,
      smoothWheel,
      autoRaf: true,
    });
    return () => {
      lenis.destroy();
    };
  }, [ref, reducedMotion, duration, smoothWheel]);
}
