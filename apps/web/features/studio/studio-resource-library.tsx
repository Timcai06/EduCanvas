'use client';

import { useMemo, useState, type ReactNode } from 'react';
import type { WorkspaceResourceSummary } from '@educanvas/canvas-protocol';
import {
  canOpenResourceLibraryItem,
  getResourceLibraryActions,
  queryResourceLibrary,
  type ResourceLibraryCategory,
  type ResourceLibrarySortKey,
  type ResourceLibrarySortOrder,
} from './resource-library-model';

const statusLabels: Record<WorkspaceResourceSummary['status'], string> = {
  processing: '处理中',
  ready: '可用',
  failed: '失败',
  unavailable: '暂不可用',
  archived: '已归档',
};

function versionLabel(summary: WorkspaceResourceSummary): string {
  if (!summary.version) return '暂无版本';
  return summary.version.sequence === null
    ? `版本 ${summary.version.versionId}`
    : `v${summary.version.sequence}`;
}

export function StudioResourceLibrary({
  summaries,
  loading = false,
  error = null,
  hasMore = false,
  onOpen,
  onLoadMore,
  onRetry,
  renderActions,
}: {
  summaries: readonly WorkspaceResourceSummary[];
  loading?: boolean;
  error?: string | null;
  hasMore?: boolean;
  onOpen: (summary: WorkspaceResourceSummary) => void;
  onLoadMore?: () => void;
  onRetry?: () => void;
  renderActions?: (summary: WorkspaceResourceSummary) => ReactNode;
}) {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<ResourceLibraryCategory>('all');
  const [status, setStatus] = useState<
    WorkspaceResourceSummary['status'] | 'all'
  >('all');
  const [contextEnabled, setContextEnabled] = useState<boolean | 'all'>('all');
  const [sort, setSort] = useState<ResourceLibrarySortKey>('updatedAt');
  const [order, setOrder] = useState<ResourceLibrarySortOrder>('desc');
  const results = useMemo(
    () =>
      queryResourceLibrary(summaries, {
        search,
        category,
        status,
        contextEnabled,
        sort,
        order,
      }),
    [summaries, search, category, status, contextEnabled, sort, order],
  );

  return (
    <section
      aria-label="资源库"
      data-studio-resource-library
      className="flex min-h-0 flex-col gap-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="resource-library-search">
          搜索资源
        </label>
        <input
          id="resource-library-search"
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="搜索标题"
          className="min-h-10 min-w-48 flex-1 rounded-xl border border-line bg-card px-3 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
        <label className="sr-only" htmlFor="resource-library-category">
          资源分类
        </label>
        <select
          id="resource-library-category"
          value={category}
          onChange={(event) =>
            setCategory(event.target.value as ResourceLibraryCategory)
          }
          className="min-h-10 rounded-xl border border-line bg-card px-2 text-sm focus-visible:ring-2 focus-visible:ring-accent"
        >
          <option value="all">全部</option>
          <option value="source">来源</option>
          <option value="artifact">AI 产物</option>
        </select>
        <label className="sr-only" htmlFor="resource-library-status">
          资源状态
        </label>
        <select
          id="resource-library-status"
          value={status}
          onChange={(event) => setStatus(event.target.value as typeof status)}
          className="min-h-10 rounded-xl border border-line bg-card px-2 text-sm focus-visible:ring-2 focus-visible:ring-accent"
        >
          <option value="all">全部状态</option>
          {Object.entries(statusLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor="resource-library-context">
          上下文状态
        </label>
        <select
          id="resource-library-context"
          value={String(contextEnabled)}
          onChange={(event) =>
            setContextEnabled(
              event.target.value === 'all'
                ? 'all'
                : event.target.value === 'true',
            )
          }
          className="min-h-10 rounded-xl border border-line bg-card px-2 text-sm focus-visible:ring-2 focus-visible:ring-accent"
        >
          <option value="all">全部上下文</option>
          <option value="true">已启用上下文</option>
          <option value="false">未启用上下文</option>
        </select>
        <label className="sr-only" htmlFor="resource-library-sort">
          排序字段
        </label>
        <select
          id="resource-library-sort"
          value={sort}
          onChange={(event) =>
            setSort(event.target.value as ResourceLibrarySortKey)
          }
          className="min-h-10 rounded-xl border border-line bg-card px-2 text-sm focus-visible:ring-2 focus-visible:ring-accent"
        >
          <option value="updatedAt">更新时间</option>
          <option value="title">标题</option>
          <option value="status">状态</option>
        </select>
        <button
          type="button"
          aria-label={order === 'desc' ? '改为升序' : '改为降序'}
          onClick={() =>
            setOrder((current) => (current === 'desc' ? 'asc' : 'desc'))
          }
          className="min-h-10 rounded-xl border border-line px-3 text-sm focus-visible:ring-2 focus-visible:ring-accent"
        >
          {order === 'desc' ? '新→旧' : '旧→新'}
        </button>
      </div>
      {error ? (
        <div
          role="alert"
          className="rounded-xl border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger"
        >
          <span>{error}</span>
          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="ml-3 underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              重试
            </button>
          ) : null}
        </div>
      ) : null}
      <div aria-live="polite" className="sr-only">
        {loading
          ? '正在加载完整资源库，搜索和排序结果仍在补充'
          : hasMore
            ? `显示 ${results.length} 项已加载资源，仍有更多页面`
            : `显示 ${results.length} 项资源，完整资源库已加载`}
      </div>
      <ul
        aria-label="资源列表"
        className="min-h-0 overflow-y-auto divide-y divide-line rounded-2xl border border-line bg-card"
      >
        {results.map((summary) => (
          <li
            key={`${summary.resourceKind}:${summary.resourceId}`}
            className="flex items-center gap-2 pr-3"
          >
            <button
              type="button"
              disabled={!canOpenResourceLibraryItem(summary)}
              onClick={() => onOpen(summary)}
              className="flex min-h-16 w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span
                aria-hidden="true"
                className="mt-1 size-2 shrink-0 rounded-full bg-accent"
              />
              <span className="min-w-0 flex-1">
                <strong className="block truncate text-sm text-ink">
                  {summary.title}
                </strong>
                <span className="mt-1 block truncate text-xs text-ink-muted">
                  {summary.renderer.rendererId} · {statusLabels[summary.status]}{' '}
                  · {versionLabel(summary)} ·{' '}
                  {summary.resourceKind === 'source'
                    ? summary.context.enabled
                      ? '已加入上下文'
                      : '未加入上下文'
                    : 'AI 产物'}{' '}
                  ·{' '}
                  {summary.surface.restState
                    ? `工作面 ${summary.surface.restState}`
                    : '未打开'}
                </span>
                <span
                  className="mt-1 flex flex-wrap gap-1"
                  aria-label="打开资源后可用的服务端授权能力"
                >
                  {getResourceLibraryActions(summary).map((action) => (
                    <span
                      key={action}
                      className="rounded bg-surface-strong px-1.5 py-0.5 text-[10px] text-ink-muted"
                    >
                      {action}
                    </span>
                  ))}
                </span>
              </span>
            </button>
            {renderActions?.(summary)}
          </li>
        ))}
        {!loading && results.length === 0 ? (
          <li className="px-4 py-8 text-center text-sm text-ink-muted">
            暂无匹配资源
          </li>
        ) : null}
      </ul>
      {loading ? (
        <p role="status" className="text-center text-xs text-ink-muted">
          正在加载资源…
        </p>
      ) : null}
      {hasMore && onLoadMore ? (
        <button
          type="button"
          onClick={onLoadMore}
          disabled={loading}
          className="min-h-10 rounded-xl border border-line px-3 text-sm text-ink-muted hover:bg-surface-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-wait disabled:opacity-50"
        >
          加载更多
        </button>
      ) : null}
    </section>
  );
}
