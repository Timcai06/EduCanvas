'use client';

import {
  ChartDonut,
  ClockCounterClockwise,
  SquaresFour,
} from '@phosphor-icons/react';
import { LogoMark } from './logo-mark';

/**
 * 顶栏只保留必要上下文。quiet 空态严格只显示品牌；阶段徽章只有服务端传入
 * 可信状态时才出现，UI 不再使用硬编码阶段暗示教学状态已经推进。
 */
export function TopBar({
  courseTitle,
  stageLabel,
  masteryPercent,
  onOpenStudio,
  onOpenProgress,
  onOpenSessions,
  quiet = false,
}: {
  courseTitle: string;
  stageLabel: string | null;
  masteryPercent: number | null;
  onOpenStudio?: () => void;
  onOpenProgress?: () => void;
  onOpenSessions?: () => void;
  quiet?: boolean;
}) {
  const percent = masteryPercent ?? 0;
  return (
    <header className="flex h-16 shrink-0 items-center gap-3 px-4 sm:px-6">
      <span className="inline-flex items-center gap-2 text-base font-semibold tracking-[-0.02em] text-ink">
        <span className="grid size-8 place-items-center rounded-full bg-accent-soft">
          <LogoMark size={17} />
        </span>
        EduCanvas
      </span>
      {!quiet && courseTitle ? (
        <>
          <span
            aria-hidden="true"
            className="hidden h-5 w-px bg-line sm:block"
          />
          <p className="hidden min-w-0 truncate text-sm text-ink-muted sm:block">
            {courseTitle}
          </p>
        </>
      ) : null}
      <span className="flex-1" />
      {!quiet && onOpenSessions ? (
        <button
          type="button"
          onClick={onOpenSessions}
          aria-label="打开学习记录"
          title="学习记录"
          className="grid size-10 place-items-center rounded-full text-ink-muted transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent lg:hidden"
        >
          <ClockCounterClockwise aria-hidden="true" size={20} />
        </button>
      ) : null}
      {!quiet && stageLabel ? (
        <span className="hidden rounded-full bg-accent-soft px-3 py-1 text-xs font-semibold text-accent-strong sm:inline-flex">
          {stageLabel}
        </span>
      ) : null}
      {!quiet && onOpenProgress ? (
        <button
          type="button"
          onClick={onOpenProgress}
          aria-label={`学习进度，当前掌握度 ${percent}%`}
          title="学习进度"
          className="inline-flex min-h-10 items-center gap-2 rounded-full px-3 text-sm font-medium text-ink-muted transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <ChartDonut aria-hidden="true" size={20} weight="regular" />
          <span className="hidden sm:inline">{percent}%</span>
        </button>
      ) : null}
      {!quiet && onOpenStudio ? (
        <button
          type="button"
          onClick={onOpenStudio}
          aria-label="本课产物"
          title="本课产物"
          className="inline-flex min-h-10 items-center gap-2 rounded-full px-3 text-sm font-medium text-ink-muted transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <SquaresFour aria-hidden="true" size={20} weight="regular" />
          <span className="hidden sm:inline">本课产物</span>
        </button>
      ) : null}
    </header>
  );
}
