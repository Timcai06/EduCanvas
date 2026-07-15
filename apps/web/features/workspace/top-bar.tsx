'use client';

/**
 * 顶栏只保留必要上下文：课程/知识点、教学阶段、掌握度微环与两个轻量入口。
 * 阶段徽章当前为演示值；服务端状态机投影接入后由可信数据驱动，UI 不提供任何
 * 修改阶段的手段（转移权在 runtime，见 docs/03-ai/agent-orchestration.md）。
 */
export function TopBar({
  courseTitle,
  stageLabel,
  masteryPercent,
  onOpenStudio,
  onOpenProgress,
}: {
  courseTitle: string;
  stageLabel: string;
  masteryPercent: number | null;
  onOpenStudio: () => void;
  onOpenProgress: () => void;
}) {
  const percent = masteryPercent ?? 0;
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 px-4 lg:px-6">
      <span className="font-display text-lg font-bold text-accent">
        EduCanvas
      </span>
      <span
        aria-hidden="true"
        className="hidden h-5 w-px bg-line sm:block"
      />
      <p className="hidden min-w-0 truncate text-sm text-ink-muted sm:block">
        {courseTitle}
      </p>
      <span className="flex-1" />
      <span className="rounded-full bg-accent-soft px-3.5 py-1 text-sm font-semibold text-accent-strong">
        {stageLabel}
      </span>
      <button
        type="button"
        onClick={onOpenProgress}
        aria-label={`学习进度，当前掌握度 ${percent}%`}
        title="学习进度"
        className="grid size-9 place-items-center rounded-full transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <span
          aria-hidden="true"
          className="grid size-7 place-items-center rounded-full text-[10px] font-bold text-accent-strong"
          style={{
            background: `conic-gradient(var(--color-accent) ${percent}%, var(--color-surface-strong) ${percent}% 100%)`,
          }}
        >
          <span className="grid size-5 place-items-center rounded-full bg-canvas">
            {percent}
          </span>
        </span>
      </button>
      <button
        type="button"
        onClick={onOpenStudio}
        className="min-h-9 rounded-full px-3.5 text-sm font-medium text-ink-muted transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        本课产物
      </button>
    </header>
  );
}
