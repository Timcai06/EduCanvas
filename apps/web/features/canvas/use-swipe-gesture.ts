'use client';

import type { PointerEvent } from 'react';
import { useRef } from 'react';

/** 三条件阈值的常量导出：测试与未来调参共用同一事实源 */
export const SWIPE_DISTANCE_PX = 30;
export const SWIPE_AXIS_LIMIT_PX = 60;
export const SWIPE_TIMEOUT_MS = 250;

/**
 * 横扫手势判定（StPageFlip 的三条件阈值，纯函数便于离线测试）：
 * 水平位移 >30px 且垂直偏移 <60px（主轴判定，防斜滑误触）且
 * 时长 <250ms（区分「滑动翻页」与「按住拖拽」两种意图）。
 */
export function resolveSwipe(
  dx: number,
  dy: number,
  elapsedMs: number,
): 'left' | 'right' | null {
  if (
    Math.abs(dx) <= SWIPE_DISTANCE_PX ||
    Math.abs(dy) >= SWIPE_AXIS_LIMIT_PX ||
    elapsedMs >= SWIPE_TIMEOUT_MS
  ) {
    return null;
  }
  return dx < 0 ? 'left' : 'right';
}

/**
 * 内容渲染器共用的横扫手势 hook。返回可直接展开到元素上的 Pointer
 * handlers；监听挂调用方元素而非 window——嵌入面板不抢全局手势。
 * 仅响应主键（触摸/笔/左键），右键上下文菜单不触发。
 */
export function useSwipeGesture({
  onSwipeLeft,
  onSwipeRight,
}: {
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
}): {
  onPointerDown: (event: PointerEvent<HTMLElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLElement>) => void;
} {
  const startRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
    time: number;
  } | null>(null);

  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    startRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      time: Date.now(),
    };
  };

  const onPointerUp = (event: PointerEvent<HTMLElement>) => {
    const start = startRef.current;
    startRef.current = null;
    if (!start || start.pointerId !== event.pointerId) return;
    const direction = resolveSwipe(
      event.clientX - start.x,
      event.clientY - start.y,
      Date.now() - start.time,
    );
    if (direction === 'left') onSwipeLeft?.();
    if (direction === 'right') onSwipeRight?.();
  };

  return { onPointerDown, onPointerUp };
}
