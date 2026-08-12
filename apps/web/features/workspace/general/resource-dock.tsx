'use client';

import {
  File,
  FilePdf,
  Image,
  MusicNote,
  SquaresFour,
  Sparkle,
  VideoCamera,
} from '@phosphor-icons/react';
import type { WorkspaceResourceSummary } from '@educanvas/canvas-protocol';
import { useRef, useState, type ComponentType } from 'react';
import {
  buildResourceDockModel,
  type ResourceDockCategory,
} from './resource-dock-model';

type ExpandableCategory = Exclude<ResourceDockCategory, 'all'>;
const VISIBLE_RESOURCE_COUNT = 6;

const categoryIcons: Record<
  ResourceDockCategory,
  ComponentType<{ size?: number; weight?: 'duotone' }>
> = {
  source: File,
  artifact: Sparkle,
  all: SquaresFour,
};

const statusLabels: Record<WorkspaceResourceSummary['status'], string> = {
  processing: '处理中',
  ready: '可用',
  failed: '失败',
  unavailable: '暂不可用',
  archived: '已归档',
};

function rendererLabel(rendererId: string): string {
  const type = rendererId.split('.').at(-1);
  return type ? type.toUpperCase() : rendererId;
}

function RendererIcon({ rendererId }: { rendererId: string }) {
  const Icon = rendererId.includes('pdf')
    ? FilePdf
    : rendererId.includes('image')
      ? Image
      : rendererId.includes('audio')
        ? MusicNote
        : rendererId.includes('video')
          ? VideoCamera
          : File;
  return <Icon size={18} weight="duotone" aria-hidden="true" />;
}

/** 右侧当前工作集：一级分类有界，详情与正文仅在用户打开资源后按需读取。 */
export function ResourceDock({
  summaries,
  loading,
  error,
  hasMore,
  onOpen,
  onOpenLibrary,
  onLoadMore,
  onRetry,
}: {
  summaries: readonly WorkspaceResourceSummary[];
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  onOpen: (summary: WorkspaceResourceSummary) => void;
  onOpenLibrary: () => void;
  onLoadMore: () => void;
  onRetry: () => void;
}) {
  const [expanded, setExpanded] = useState<ExpandableCategory | null>(null);
  const tabsRef = useRef<HTMLElement>(null);
  const model = buildResourceDockModel(summaries, {
    visibleLimit: VISIBLE_RESOURCE_COUNT,
    hasUnloadedPages: hasMore,
  });
  const expandableSections = model.sections.filter(
    (
      section,
    ): section is (typeof model.sections)[number] & {
      id: ExpandableCategory;
    } => section.id !== 'all',
  );
  const section = expanded
    ? expandableSections.find((candidate) => candidate.id === expanded)
    : undefined;

  const moveFocus = (key: string) => {
    const buttons = [
      ...(tabsRef.current?.querySelectorAll<HTMLButtonElement>(
        '[data-dock-category]',
      ) ?? []),
    ];
    const current = buttons.findIndex(
      (button) => button === document.activeElement,
    );
    const next =
      key === 'Home'
        ? 0
        : key === 'End'
          ? buttons.length - 1
          : (current + (key === 'ArrowDown' ? 1 : -1) + buttons.length) %
            buttons.length;
    buttons[next]?.focus();
  };

  return (
    <aside
      aria-label="资源 Dock"
      data-resource-dock
      className="absolute top-1/2 right-2 z-40 -translate-y-1/2"
    >
      <nav
        ref={tabsRef}
        aria-label="资源分类"
        className="flex flex-col gap-2 rounded-2xl border border-line bg-card/95 p-2 shadow-[var(--shadow-float)] backdrop-blur-md"
        onKeyDown={(event) => {
          if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key))
            return;
          event.preventDefault();
          moveFocus(event.key);
        }}
      >
        {model.sections.map((candidate) => {
          const Icon = categoryIcons[candidate.id];
          const isExpandable = candidate.id !== 'all';
          const selected = isExpandable && candidate.id === expanded;
          const enabledCount = candidate.items.filter(
            (entry) => entry.contextEnabled,
          ).length;
          const processingCount = candidate.items.filter(
            (entry) => entry.status === 'processing',
          ).length;
          const failed = candidate.items.some(
            (entry) => entry.status === 'failed',
          );
          const failedCount = candidate.items.filter(
            (entry) => entry.status === 'failed',
          ).length;
          const countLabel =
            candidate.id === 'source'
              ? `${enabledCount}/${candidate.items.length}${hasMore ? '+' : ''}`
              : `${candidate.items.length}${hasMore ? '+' : ''}`;
          return (
            <button
              key={candidate.id}
              id={`resource-dock-tab-${candidate.id}`}
              type="button"
              aria-expanded={isExpandable ? selected : undefined}
              aria-controls={
                isExpandable ? `resource-dock-panel-${candidate.id}` : undefined
              }
              aria-label={
                candidate.id === 'source'
                  ? `来源，已启用 ${enabledCount} 项，已加载 ${candidate.items.length} 项，处理中 ${processingCount} 项，失败 ${failedCount} 项${candidate.hasUnloadedPages ? '，另有未加载资源' : ''}`
                  : candidate.id === 'artifact'
                    ? `AI 产物，已加载 ${candidate.items.length} 项，处理中 ${processingCount} 项，失败 ${failedCount} 项${candidate.hasUnloadedPages ? '，另有未加载资源' : ''}`
                    : '打开全部资源'
              }
              data-dock-category
              onClick={() => {
                if (candidate.id === 'all') onOpenLibrary();
                else setExpanded(selected ? null : candidate.id);
              }}
              className="relative flex h-12 w-12 items-center justify-center rounded-xl text-ink-muted transition-colors hover:bg-surface-strong hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent motion-safe:transition-[color,background-color,transform] motion-safe:duration-200 aria-expanded:bg-surface-strong aria-expanded:text-ink"
            >
              <Icon size={21} weight="duotone" aria-hidden="true" />
              {candidate.id !== 'all' ? (
                <span
                  className="absolute -top-1 -right-1 min-w-5 rounded-full bg-accent px-1 text-center text-[10px] leading-5 text-white"
                  aria-hidden="true"
                >
                  {countLabel}
                </span>
              ) : null}
              {failed || processingCount > 0 ? (
                <span
                  className={`absolute bottom-1 right-1 h-2 w-2 rounded-full ${failed ? 'bg-danger' : 'bg-warning'}`}
                  aria-hidden="true"
                />
              ) : null}
            </button>
          );
        })}
      </nav>

      {section ? (
        <div
          id={`resource-dock-panel-${section.id}`}
          role="region"
          aria-labelledby={`resource-dock-tab-${section.id}`}
          className="absolute top-0 right-full mr-2 flex max-h-[min(32rem,70vh)] w-80 flex-col overflow-y-auto rounded-2xl border border-line bg-card/95 p-2 shadow-[var(--shadow-float)] backdrop-blur-md motion-safe:transition-[opacity,transform] motion-safe:duration-200"
        >
          {section.visibleItems.map((entry) => {
            const context =
              entry.contextEnabled === null
                ? null
                : entry.contextEnabled
                  ? '已加入上下文'
                  : '未加入上下文';
            const restState = entry.surfaceRestState
              ? `工作面：${entry.surfaceRestState}`
              : '未固定到工作面';
            const version = entry.summary.version
              ? entry.summary.version.sequence === null
                ? '已冻结版本'
                : `v${entry.summary.version.sequence}`
              : '暂无可读版本';
            return (
              <button
                key={`${entry.summary.resourceKind}:${entry.summary.resourceId}`}
                type="button"
                onClick={() => {
                  setExpanded(null);
                  onOpen(entry.summary);
                }}
                className="flex min-h-14 w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm text-ink transition-colors hover:bg-surface-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <span className="shrink-0 text-ink-muted">
                  <RendererIcon rendererId={entry.rendererId} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{entry.summary.title}</span>
                  <span className="block truncate text-xs text-ink-muted">
                    {rendererLabel(entry.rendererId)} ·{' '}
                    {statusLabels[entry.status]} · {version}
                    {context ? ` · ${context}` : ''} · {restState}
                  </span>
                </span>
              </button>
            );
          })}
          {!loading && section.items.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-ink-muted">
              此分类暂无资源
            </p>
          ) : null}
          {section.hiddenLoadedCount > 0 ? (
            <p className="px-3 py-2 text-xs text-ink-muted">
              还有 {section.hiddenLoadedCount} 项已加载资源未在快捷区显示
            </p>
          ) : null}
          {error ? (
            <div className="px-3 py-2 text-sm text-danger" role="status">
              <p>{error}</p>
              <button
                type="button"
                className="mt-2 underline"
                onClick={onRetry}
              >
                重试
              </button>
            </div>
          ) : null}
          {loading ? (
            <p className="px-3 py-2 text-xs text-ink-muted" role="status">
              正在加载资源…
            </p>
          ) : hasMore ? (
            <button
              type="button"
              onClick={onLoadMore}
              className="w-full rounded-xl px-3 py-2 text-sm text-accent-strong hover:bg-surface-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              加载更多（仍有未加载资源）
            </button>
          ) : null}
          <button
            type="button"
            onClick={onOpenLibrary}
            className="w-full rounded-xl px-3 py-2 text-sm text-ink-muted hover:bg-surface-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            查看全部资源
          </button>
        </div>
      ) : null}
    </aside>
  );
}
