'use client';

import { Desktop, Moon, Sun } from '@phosphor-icons/react';
import { useThemePreference, type ThemePreference } from './use-theme';

/**
 * 三段主题控件：跟随系统 / 纸色亮 / 砚墨暗。走「两支笔」纸墨身份——tokens only、
 * 禁 text-white，选中态用黛青（accent），过渡在 reduced-motion 下取消。
 * 无障碍：每段 aria-pressed 表达当前选择，键盘可 Tab 到达并 focus-visible 焦点环，
 * 切换时经 aria-live 区播报当前主题。控件本身不解析系统明暗，只表达偏好。
 */
const OPTIONS: ReadonlyArray<{
  value: ThemePreference;
  label: string;
  Icon: typeof Desktop;
}> = [
  { value: 'system', label: '跟随系统', Icon: Desktop },
  { value: 'light', label: '纸色亮', Icon: Sun },
  { value: 'dark', label: '砚墨暗', Icon: Moon },
];

export function ThemeToggle() {
  const { preference, setPreference } = useThemePreference();
  const activeLabel =
    OPTIONS.find((option) => option.value === preference)?.label ?? '跟随系统';

  return (
    <div
      role="group"
      aria-label="界面主题"
      className="inline-flex items-center gap-1 rounded-full border border-line bg-card p-1 shadow-float"
    >
      {OPTIONS.map(({ value, label, Icon }) => {
        const selected = preference === value;
        return (
          <button
            key={value}
            type="button"
            aria-pressed={selected}
            onClick={() => setPreference(value)}
            className={`inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-card motion-reduce:transition-none ${
              selected
                ? 'bg-accent-soft text-accent-strong'
                : 'text-ink-muted hover:bg-surface hover:text-ink'
            }`}
          >
            <Icon
              aria-hidden="true"
              size={16}
              weight={selected ? 'fill' : 'regular'}
            />
            <span>{label}</span>
          </button>
        );
      })}
      {/* 切换时向读屏器播报当前主题；aria-pressed 已表达焦点态，这里补一次显式播报 */}
      <span
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        当前主题：{activeLabel}
      </span>
    </div>
  );
}
