'use client';

import { useGSAP } from '@gsap/react';
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
import gsap from 'gsap';
import { useEffect, useRef, useState, type ComponentType } from 'react';
import { motionDuration } from '@/features/theme/motion';
import {
  buildResourceDockModel,
  type ResourceDockCategory,
} from './resource-dock-model';

gsap.registerPlugin(useGSAP);

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

/* 贴右缘半卡形态：宽度增长是布局变化（不随 reduced-motion 关闭），颜色与边框才走动效过渡。 */
const RAIL_BUTTON_CLASS =
  'relative flex h-12 w-11 items-center justify-center rounded-l-xl border border-r-0 ' +
  'border-line/80 bg-card/92 text-ink-muted shadow-[var(--shadow-float)] backdrop-blur-md ' +
  'transition-[width,color,border-color,background-color] duration-200 ' +
  'hover:w-14 hover:border-accent/35 hover:text-accent-strong ' +
  'focus-visible:w-14 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ' +
  'aria-expanded:w-14 aria-expanded:border-accent/50 aria-expanded:bg-surface-strong aria-expanded:text-ink';

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
  onExpand,
}: {
  summaries: readonly WorkspaceResourceSummary[];
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  onOpen: (summary: WorkspaceResourceSummary) => void;
  onOpenLibrary: () => void;
  onLoadMore: () => void;
  onRetry: () => void;
  /* 展开分类时回调：面板打开即拉最新第一页，避免陈旧列表误导。 */
  onExpand?: () => void;
}) {
  const [expanded, setExpanded] = useState<ExpandableCategory | null>(null);
  const dockRef = useRef<HTMLElement>(null);
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

  /* rail 三枚入口的 stagger 入场；只动 transform/opacity，支持 reduced-motion 跳过。 */
  useGSAP(
    () => {
      const media = gsap.matchMedia();
      media.add('(prefers-reduced-motion: no-preference)', () => {
        gsap.fromTo(
          '[data-dock-category]',
          { x: 18, opacity: 0 },
          {
            x: 0,
            opacity: 1,
            duration: motionDuration('fast'),
            ease: 'power2.out',
            stagger: 0.045,
            clearProps: 'transform,opacity',
          },
        );
      });
      return () => media.revert();
    },
    { scope: dockRef },
  );

  useEffect(() => {
    if (!expanded) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && dockRef.current?.contains(target)) return;
      setExpanded(null);
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    return () =>
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
  }, [expanded]);

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

  const toggleCategory = (category: ResourceDockCategory) => {
    if (category === 'all') {
      setExpanded(null);
      onOpenLibrary();
      return;
    }
    const open = expanded !== category;
    setExpanded(open ? category : null);
    if (open) onExpand?.();
  };

  return (
    <aside
      ref={dockRef}
      aria-label="资源 Dock"
      data-resource-dock
      className="absolute top-1/2 right-2 z-40 -translate-y-1/2"
    >
      <nav
        ref={tabsRef}
        aria-label="资源分类"
        className="flex flex-col gap-2"
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
              onClick={() => toggleCategory(candidate.id)}
              className={`${RAIL_BUTTON_CLASS} ${candidate.id === 'all' ? 'mt-2' : ''}`}
            >
              <Icon size={17} weight="duotone" aria-hidden="true" />
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
          className="absolute top-0 right-full mr-2 flex max-h-[min(32rem,calc(50dvh_-_2.5rem))] w-80 flex-col rounded-2xl border border-line bg-card/95 p-2 shadow-[var(--shadow-float)] backdrop-blur-md motion-safe:transition-[opacity,transform] motion-safe:duration-200"
        >
          <div className="min-h-0 flex-1 overflow-y-auto">
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
                  disabled={
                    !entry.summary.allowedActions.includes('view') ||
                    entry.summary.version === null ||
                    entry.status === 'failed' ||
                    entry.status === 'unavailable'
                  }
                  onClick={() => {
                    setExpanded(null);
                    onOpen(entry.summary);
                  }}
                  className="flex min-h-14 w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm text-ink transition-colors hover:bg-surface-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span className="shrink-0 text-ink-muted">
                    <RendererIcon rendererId={entry.rendererId} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">
                      {entry.summary.title}
                    </span>
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
          </div>
          <button
            type="button"
            onClick={onOpenLibrary}
            className="mt-2 w-full shrink-0 rounded-xl px-3 py-2 text-sm text-ink-muted hover:bg-surface-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            查看全部资源
          </button>
        </div>
      ) : null}
    </aside>
  );
}
