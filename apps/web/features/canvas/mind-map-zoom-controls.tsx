'use client';

import { CornersOut, Minus, Plus, type Icon } from '@phosphor-icons/react';

interface ZoomAction {
  label: string;
  icon: Icon;
  onSelect: () => void;
}

/**
 * 思维导图缩放控件浮层（从渲染器主体拆出以守住文件治理基线）。
 * data-mindmap-control 同时豁免画布拖拽与指针捕获；缩放原点由调用方
 * 决定（控件=视口中心，滚轮/快捷键=光标）。
 */
export function MindMapZoomControls({
  onZoomIn,
  onZoomOut,
  onFit,
}: {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
}) {
  const actions: Array<ZoomAction> = [
    { label: '放大', icon: Plus, onSelect: onZoomIn },
    { label: '缩小', icon: Minus, onSelect: onZoomOut },
    { label: '适应画布', icon: CornersOut, onSelect: onFit },
  ];
  return (
    <div
      className="absolute right-3 bottom-3 z-10 flex flex-col gap-1.5"
      data-mindmap-control
    >
      {actions.map(({ label, icon: Icon, onSelect }) => (
        <button
          key={label}
          type="button"
          data-mindmap-control
          aria-label={label}
          title={label}
          onClick={onSelect}
          className="grid size-8 place-items-center rounded-full border border-line/70 bg-card/95 text-ink-muted shadow-sm backdrop-blur transition-colors hover:bg-surface hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <Icon aria-hidden="true" size={14} />
        </button>
      ))}
    </div>
  );
}
