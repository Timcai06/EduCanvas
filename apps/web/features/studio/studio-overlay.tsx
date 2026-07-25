'use client';

import { useEffect, useRef } from 'react';

/**
 * Studio 的透明浮层。它只为 OptionWheel 与动作气泡提供定位空间，不绘制面板、
 * 遮罩或轨道，也不改变对话与历史列表的布局。
 */
export function StudioOverlay({
  onClose,
  children,
}: {
  onClose: () => void;
  children: React.ReactNode;
}) {
  const rootRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose();
    };
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (rootRef.current?.contains(target)) return;
      if (target.closest('[data-studio-trigger]')) return;
      onClose();
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('pointerdown', handlePointerDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [onClose]);

  return (
    <aside
      ref={rootRef}
      id="notebook-studio-layer"
      aria-label="当前笔记本的 Studio"
      className="pointer-events-none fixed right-0 top-16 z-30 h-[min(34rem,calc(100dvh-4rem))] w-full max-w-[34rem] overflow-visible"
    >
      {children}
    </aside>
  );
}
