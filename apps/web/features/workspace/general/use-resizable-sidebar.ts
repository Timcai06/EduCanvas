'use client';

import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from 'react';

const STORAGE_KEY = 'educanvas.sidebar-width.v1';
const DEFAULT_WIDTH = 256;
export const SIDEBAR_WIDTH_MIN = 224;
export const SIDEBAR_WIDTH_MAX = 400;

const clampWidth = (width: number) =>
  Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, width));

/**
 * 桌面 Notebook 侧栏宽度控制器。只在指针释放或键盘调整后持久化，
 * 指针移动阶段保留在内存，避免高频 localStorage 写入拖慢交互。
 */
export function useResizableSidebar() {
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const widthRef = useRef(DEFAULT_WIDTH);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startWidth: number;
  } | null>(null);

  useEffect(() => {
    const stored = Number.parseInt(
      window.localStorage.getItem(STORAGE_KEY) ?? '',
      10,
    );
    if (!Number.isFinite(stored)) return;
    const frame = window.requestAnimationFrame(() => {
      const next = clampWidth(stored);
      widthRef.current = next;
      setWidth(next);
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: width,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const next = clampWidth(drag.startWidth + event.clientX - drag.startX);
    widthRef.current = next;
    setWidth(next);
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    window.localStorage.setItem(STORAGE_KEY, String(widthRef.current));
  };

  const onPointerCancel = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const next = clampWidth(width + (event.key === 'ArrowLeft' ? -16 : 16));
    widthRef.current = next;
    setWidth(next);
    window.localStorage.setItem(STORAGE_KEY, String(next));
  };

  return {
    width,
    style: { '--sidebar-width': `${width}px` } as CSSProperties,
    separatorProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      onKeyDown,
    },
  };
}
