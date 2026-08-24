'use client';

import {
  ArrowDown,
  ArrowUp,
  File,
  FilePdf,
  Image,
  MagnifyingGlass,
  MusicNote,
  Sparkle,
  VideoCamera,
} from '@phosphor-icons/react';
import type { WorkspaceResourceSummary } from '@educanvas/canvas-protocol';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  canOpenResourceLibraryItem,
  getResourceLibraryActions,
  queryResourceLibrary,
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
    ? '冻结版本'
    : `v${summary.version.sequence}`;
}

function ResourceIcon({ summary }: { summary: WorkspaceResourceSummary }) {
  const rendererId = summary.renderer.rendererId;
  const Icon = rendererId.includes('pdf')
    ? FilePdf
    : rendererId.includes('image')
      ? Image
      : rendererId.includes('audio')
        ? MusicNote
        : rendererId.includes('video')
          ? VideoCamera
          : summary.resourceKind === 'artifact'
            ? Sparkle
            : File;
  return <Icon size={19} weight="duotone" aria-hidden="true" />;
}

function formatUpdatedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '时间未知';
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function ResourceView({
  label,
  results,
  loading,
  onOpen,
  renderActions,
}: {
  label: string;
  results: readonly WorkspaceResourceSummary[];
  loading: boolean;
  onOpen: (summary: WorkspaceResourceSummary) => void;
  renderActions?: (summary: WorkspaceResourceSummary) => ReactNode;
}) {
  const listRef = useRef<HTMLUListElement>(null);
  /* 资源库可长可短，用 @tanstack/react-virtual 窗口化：只渲染可视区资源行，
     spacer 占满总高度保证滚动条真实，避免长库一次性 build 出全部行。 */
  // eslint-disable-next-line react-hooks/incompatible-library -- useVirtualizer 返回不可被 React Compiler 安全记忆化的函数（库 API 特性）；窗口化需要最新滚动/尺寸回调，跳过记忆化是有意的性能取舍。
  const virtualizer = useVirtualizer({
    count: results.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => 72,
    overscan: 8,
  });
  return (
    <div className="studio-resource-view">
      <div className="studio-resource-table-head" aria-hidden="true">
        <span>资料</span>
        <span>状态</span>
        <span>更新时间</span>
        <span>操作</span>
      </div>
      <ul aria-label={label} ref={listRef} className="studio-resource-list">
        {/* 总高 spacer：撑起可滚动内容区，让绝对定位的行在视口内逐条显形 */}
        <li
          className="studio-resource-spacer"
          style={{ height: virtualizer.getTotalSize() }}
          aria-hidden="true"
        />
        {virtualizer.getVirtualItems().map((item) => {
          const summary = results[item.index]!;
          return (
            <li
              key={`${summary.resourceKind}:${summary.resourceId}`}
              data-index={item.index}
              ref={virtualizer.measureElement}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${item.start}px)`,
              }}
            >
              <button
                type="button"
                disabled={!canOpenResourceLibraryItem(summary)}
                onClick={() => onOpen(summary)}
                className="studio-resource-open"
              >
                <span className="studio-resource-icon">
                  <ResourceIcon summary={summary} />
                </span>
                <span className="studio-resource-title">
                  <strong>{summary.title}</strong>
                  <small>
                    {summary.renderer.rendererId
                      .split('.')
                      .at(-1)
                      ?.toUpperCase()}
                    {' · '}
                    {versionLabel(summary)}
                    {summary.resourceKind === 'source'
                      ? summary.context.enabled
                        ? ' · 已加入上下文'
                        : ' · 未加入上下文'
                      : ' · AI 输出'}
                    {summary.resourceKind === 'source' &&
                    summary.context.researchSource
                      ? ' · 研究来源'
                      : null}
                  </small>
                </span>
                <span
                  className="studio-resource-status"
                  data-status={summary.status}
                >
                  <i aria-hidden="true" />
                  {statusLabels[summary.status]}
                </span>
                <time dateTime={summary.updatedAt}>
                  {formatUpdatedAt(summary.updatedAt)}
                </time>
              </button>
              <div className="studio-resource-row-actions">
                {renderActions?.(summary) ?? (
                  <span>
                    {getResourceLibraryActions(summary).includes('view')
                      ? '打开'
                      : '只读'}
                  </span>
                )}
              </div>
            </li>
          );
        })}
        {!loading && results.length === 0 ? (
          <li className="studio-resource-empty">
            <span>
              {label === '来源列表' ? '还没有匹配的来源' : '还没有匹配的输出'}
            </span>
            <small>
              {label === '来源列表'
                ? '把图片或文档加入对话后，会在这里统一管理。'
                : '让 EduCanvas 生成笔记、图表或演示文稿后，会沉淀在这里。'}
            </small>
          </li>
        ) : null}
      </ul>
    </div>
  );
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
  const [category, setCategory] = useState<'source' | 'artifact'>('source');
  const [status, setStatus] = useState<
    WorkspaceResourceSummary['status'] | 'all'
  >('all');
  const [contextEnabled, setContextEnabled] = useState<boolean | 'all'>('all');
  const [sort, setSort] = useState<ResourceLibrarySortKey>('updatedAt');
  const [order, setOrder] = useState<ResourceLibrarySortOrder>('desc');

  const sourceResults = useMemo(
    () =>
      queryResourceLibrary(summaries, {
        search,
        category: 'source',
        status,
        contextEnabled,
        sort,
        order,
      }),
    [summaries, search, status, contextEnabled, sort, order],
  );
  const artifactResults = useMemo(
    () =>
      queryResourceLibrary(summaries, {
        search,
        category: 'artifact',
        status,
        sort,
        order,
      }),
    [summaries, search, status, sort, order],
  );
  const sourceCount = summaries.filter(
    (summary) => summary.resourceKind === 'source',
  ).length;
  const artifactCount = summaries.length - sourceCount;
  const contextCount = summaries.filter(
    (summary) => summary.resourceKind === 'source' && summary.context.enabled,
  ).length;
  const attentionCount = summaries.filter((summary) =>
    ['processing', 'failed'].includes(summary.status),
  ).length;
  const currentResults =
    category === 'source' ? sourceResults : artifactResults;

  return (
    <section
      aria-label="会话资源管理"
      data-studio-resource-library
      className="studio-resource-library"
    >
      <header className="studio-resource-header">
        <div>
          <p>SESSION LIBRARY</p>
          <h2>来源与输出</h2>
          <span>当前笔记本的输入、上下文与 AI 产物在同一处管理。</span>
        </div>
        <div
          className="studio-resource-tabs"
          role="tablist"
          aria-label="资源类型"
        >
          <button
            type="button"
            role="tab"
            aria-selected={category === 'source'}
            onClick={() => setCategory('source')}
          >
            来源 <span>{sourceCount}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={category === 'artifact'}
            onClick={() => setCategory('artifact')}
          >
            输出 <span>{artifactCount}</span>
          </button>
        </div>
      </header>

      <div className="studio-resource-metrics" aria-label="会话资源概览">
        <article>
          <span>全部资料</span>
          <strong>{summaries.length}</strong>
          <small>当前已加载</small>
        </article>
        <article>
          <span>来源</span>
          <strong>{sourceCount}</strong>
          <small>用户输入与引用</small>
        </article>
        <article>
          <span>AI 输出</span>
          <strong>{artifactCount}</strong>
          <small>可继续编辑与导出</small>
        </article>
        <article data-attention={attentionCount > 0 || undefined}>
          <span>本轮上下文</span>
          <strong>{contextCount}</strong>
          <small>
            {attentionCount > 0 ? `${attentionCount} 项待处理` : '状态正常'}
          </small>
        </article>
      </div>

      <div className="studio-resource-controls">
        <label className="studio-resource-search">
          <MagnifyingGlass size={17} aria-hidden="true" />
          <span className="sr-only">搜索资源</span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索当前会话"
          />
        </label>
        <label>
          <span className="sr-only">资源状态</span>
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value as typeof status)}
          >
            <option value="all">全部状态</option>
            {Object.entries(statusLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {category === 'source' ? (
          <label>
            <span className="sr-only">上下文状态</span>
            <select
              value={String(contextEnabled)}
              onChange={(event) =>
                setContextEnabled(
                  event.target.value === 'all'
                    ? 'all'
                    : event.target.value === 'true',
                )
              }
            >
              <option value="all">全部上下文</option>
              <option value="true">已加入本轮</option>
              <option value="false">未加入本轮</option>
            </select>
          </label>
        ) : null}
        <label>
          <span className="sr-only">排序字段</span>
          <select
            value={sort}
            onChange={(event) =>
              setSort(event.target.value as ResourceLibrarySortKey)
            }
          >
            <option value="updatedAt">更新时间</option>
            <option value="title">标题</option>
            <option value="status">状态</option>
          </select>
        </label>
        <button
          type="button"
          aria-label={order === 'desc' ? '改为升序' : '改为降序'}
          onClick={() =>
            setOrder((current) => (current === 'desc' ? 'asc' : 'desc'))
          }
        >
          {order === 'desc' ? <ArrowDown size={16} /> : <ArrowUp size={16} />}
          {order === 'desc' ? '新到旧' : '旧到新'}
        </button>
      </div>

      {error ? (
        <div role="alert" className="studio-resource-error">
          <span>{error}</span>
          {onRetry ? (
            <button type="button" onClick={onRetry}>
              重试
            </button>
          ) : null}
        </div>
      ) : null}
      <div aria-live="polite" className="sr-only">
        {loading
          ? '正在加载完整资源库，搜索和排序结果仍在补充'
          : hasMore
            ? `显示 ${currentResults.length} 项已加载资源，仍有更多页面`
            : `显示 ${currentResults.length} 项资源，完整资源库已加载`}
      </div>

      <div className="studio-resource-table-shell">
        {category === 'source' ? (
          <ResourceView
            label="来源列表"
            results={sourceResults}
            loading={loading}
            onOpen={onOpen}
            renderActions={renderActions}
          />
        ) : (
          <ResourceView
            label="输出列表"
            results={artifactResults}
            loading={loading}
            onOpen={onOpen}
          />
        )}
      </div>

      <footer className="studio-resource-footer">
        <span>
          {loading ? '正在同步资源…' : `当前显示 ${currentResults.length} 项`}
        </span>
        {hasMore && onLoadMore ? (
          <button type="button" onClick={onLoadMore} disabled={loading}>
            加载更多
          </button>
        ) : (
          <span>已加载完整会话资源</span>
        )}
      </footer>
    </section>
  );
}
