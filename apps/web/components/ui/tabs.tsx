'use client';

import type { ReactNode } from 'react';

/*
 * 胶囊页签（Tabs）：受控 tablist/tab/tabpanel，role 语义 + aria-selected/controls 供读屏与键盘。
 * 视觉只做「选中纸面浮起」的 pill 切换，样式全走 token；滑动指示器这类花活由调用方按需叠加
 * （如 studio-resource-library 已内置 .studio-tab-indicator，此处不重复内置以免冲突）。
 */
export interface TabItem {
  id: string;
  label: ReactNode;
  /** 选中面板内容；Tabs 会在 tabpanel 里渲染当前选中项的内容。 */
  content?: ReactNode;
  disabled?: boolean;
}

interface TabsProps {
  items: TabItem[];
  /** 当前选中项 id（受控）。 */
  value: string;
  onChange: (id: string) => void;
  'aria-label'?: string;
  className?: string;
}

export function Tabs({
  items,
  value,
  onChange,
  'aria-label': ariaLabel,
  className = '',
}: TabsProps) {
  return (
    <div className={className}>
      <div
        role="tablist"
        aria-label={ariaLabel}
        className="flex w-fit items-center gap-1 rounded-full border border-line/70 bg-surface/60 p-1"
      >
        {items.map((item) => {
          const selected = item.id === value;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              id={`tab-${item.id}`}
              aria-selected={selected}
              aria-controls={`panel-${item.id}`}
              disabled={item.disabled}
              onClick={() => onChange(item.id)}
              className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-accent ${
                selected
                  ? 'bg-card text-ink shadow-[var(--shadow-float)]'
                  : 'text-ink-muted hover:text-ink'
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </div>
      {items.map((item) =>
        item.id === value ? (
          <div
            key={item.id}
            role="tabpanel"
            id={`panel-${item.id}`}
            aria-labelledby={`tab-${item.id}`}
            className="mt-3"
          >
            {item.content}
          </div>
        ) : null,
      )}
    </div>
  );
}

export default Tabs;
