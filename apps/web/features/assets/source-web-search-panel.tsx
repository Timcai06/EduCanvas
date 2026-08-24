'use client';

import {
  ArrowClockwise,
  CheckCircle,
  GlobeSimple,
  MagnifyingGlass,
  SpinnerGap,
  WarningCircle,
} from '@phosphor-icons/react';
import { useRef, useState } from 'react';
import type { AssetItem } from './assets-drawer';
import { LinkAssetClientError } from './link-client-contract';
import { SourceWebSearchResultLink } from './source-web-search-result-link';
import { importWorkspaceLink } from './source-intake';
import {
  LINK_IMPORT_CONCURRENCY,
  mapWithConcurrency,
} from './link-import-batch';
import {
  searchWebSources,
  WebSearchClientError,
  type WebSearchResult,
} from './web-search-client';

type ImportPhase = 'idle' | 'processing' | 'ready' | 'failed';

interface SearchItem extends WebSearchResult {
  selected: boolean;
  phase: ImportPhase;
  error: string | null;
}

function toSearchItem(result: WebSearchResult): SearchItem {
  return {
    ...result,
    selected: false,
    phase: result.imported ? 'ready' : 'idle',
    error: null,
  };
}

function searchFailure(error: unknown): {
  message: string;
  retryable: boolean;
} {
  return error instanceof WebSearchClientError
    ? { message: error.message, retryable: error.retryable }
    : { message: '网页搜索暂时不可用。请稍后重试。', retryable: true };
}

function importFailure(error: unknown): string {
  return error instanceof LinkAssetClientError
    ? error.message
    : '该网页暂时无法导入。请重试或改用网址入口。';
}

function accessibilityCopy(
  accessibility: WebSearchResult['accessibility'],
): string {
  switch (accessibility) {
    case 'accessible':
      return '可访问性：可读取';
    case 'unavailable':
      return '可访问性：暂不可用';
    case 'unchecked':
      return '可访问性：导入时检查';
  }
}

/** WS03 浏览器搜索入口：结果只使用 Provider-neutral 客户端契约，并直接批量导入。 */
export function SourceWebSearchPanel({
  onImported,
}: {
  onImported: (asset: AssetItem) => void;
}) {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<readonly SearchItem[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [searching, setSearching] = useState(false);
  const [importing, setImporting] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [canRetrySearch, setCanRetrySearch] = useState(false);
  const searchRunRef = useRef(0);
  const searchRunningRef = useRef(false);
  const importRunningRef = useRef(false);

  const runSearch = async () => {
    const normalized = query.trim();
    if (normalized.length < 2 || searchRunningRef.current) return;
    searchRunningRef.current = true;
    const run = searchRunRef.current + 1;
    searchRunRef.current = run;
    setSearching(true);
    setHasSearched(false);
    setSearchError(null);
    try {
      const results = await searchWebSources(normalized);
      if (searchRunRef.current === run) {
        setItems(results.map(toSearchItem));
        setHasSearched(true);
        setCanRetrySearch(false);
      }
    } catch (error) {
      if (searchRunRef.current === run) {
        const failure = searchFailure(error);
        setSearchError(failure.message);
        setCanRetrySearch(failure.retryable);
        setItems([]);
      }
    } finally {
      if (searchRunRef.current === run) {
        searchRunningRef.current = false;
        setSearching(false);
      }
    }
  };

  const updateItem = (
    url: string,
    update: (item: SearchItem) => SearchItem,
  ) => {
    setItems((current) =>
      current.map((item) => (item.url === url ? update(item) : item)),
    );
  };

  const importOne = async (item: SearchItem) => {
    updateItem(item.url, (current) => ({
      ...current,
      phase: 'processing',
      error: null,
    }));
    try {
      const asset = await importWorkspaceLink(item.url);
      updateItem(item.url, (current) => ({
        ...current,
        imported: true,
        selected: false,
        phase: 'ready',
        error: null,
      }));
      onImported(asset);
    } catch (error) {
      updateItem(item.url, (current) => ({
        ...current,
        phase: 'failed',
        error: importFailure(error),
      }));
    }
  };

  const importSelected = async () => {
    if (importRunningRef.current) return;
    const selected = items.filter(
      (item) => item.selected && item.phase !== 'ready',
    );
    if (selected.length === 0) return;
    importRunningRef.current = true;
    setImporting(true);
    try {
      await mapWithConcurrency(selected, LINK_IMPORT_CONCURRENCY, importOne);
    } finally {
      importRunningRef.current = false;
      setImporting(false);
    }
  };

  const selectable = items.filter((item) => item.phase !== 'ready');
  const selectedCount = selectable.filter((item) => item.selected).length;
  const allSelected =
    selectable.length > 0 && selectedCount === selectable.length;
  const hasUncheckedResults = items.some(
    (item) => item.accessibility === 'unchecked',
  );

  return (
    <div
      className="space-y-5"
      id="source-link-search-panel"
      role="tabpanel"
      aria-labelledby="source-link-search-tab"
    >
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          void runSearch();
        }}
      >
        <label className="block" htmlFor="source-web-search-query">
          <span className="mb-2 block text-sm font-medium text-ink">
            检索词
          </span>
          <div className="flex gap-2">
            <input
              id="source-web-search-query"
              autoFocus
              type="search"
              value={query}
              disabled={searching || importing}
              placeholder="例如：生成式 AI 教学研究"
              onChange={(event) => setQuery(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && event.nativeEvent.isComposing) {
                  event.preventDefault();
                }
              }}
              className="ec-input min-h-12 min-w-0 flex-1 rounded-2xl px-4 text-sm text-ink"
            />
            <button
              type="submit"
              disabled={searching || importing || query.trim().length < 2}
              className="inline-flex min-h-12 min-w-12 items-center justify-center gap-2 rounded-2xl bg-accent px-4 font-medium text-card hover:bg-accent-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:bg-surface-strong disabled:text-ink-faint"
            >
              {searching ? (
                <SpinnerGap
                  size={18}
                  className="animate-spin motion-reduce:animate-none"
                  aria-hidden="true"
                />
              ) : (
                <MagnifyingGlass size={18} aria-hidden="true" />
              )}
              {searching ? '搜索中…' : '搜索'}
            </button>
          </div>
        </label>
      </form>

      {searchError ? (
        <div
          className="rounded-2xl border border-bad/30 bg-bad/5 p-4"
          role="alert"
        >
          <p className="text-sm text-bad">{searchError}</p>
          {canRetrySearch ? (
            <button
              type="button"
              onClick={() => void runSearch()}
              className="mt-2 inline-flex min-h-8 items-center gap-1 rounded-xl px-2 text-xs font-medium text-accent hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <ArrowClockwise size={14} aria-hidden="true" />
              重试搜索
            </button>
          ) : null}
        </div>
      ) : null}

      {!searching && !searchError && items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line p-5 text-center">
          <GlobeSimple
            size={24}
            className="mx-auto text-ink-faint"
            aria-hidden="true"
          />
          <p className="mt-2 text-sm text-ink-muted">
            {hasSearched
              ? '没有找到可导入的网页。请调整检索词，或改用网址入口。'
              : '输入检索词，选择结果后直接导入当前笔记本。'}
          </p>
        </div>
      ) : null}

      {items.length > 0 ? (
        <section aria-labelledby="source-web-search-results-title">
          {hasUncheckedResults ? (
            <p className="mb-3 text-xs leading-5 text-ink-muted" role="status">
              当前网络无法预检网页，搜索结果将在导入时进行安全检查。
            </p>
          ) : null}
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3
              id="source-web-search-results-title"
              className="text-sm font-semibold text-ink"
            >
              搜索结果（{items.length}）
            </h3>
            <label className="inline-flex min-h-8 items-center gap-2 text-xs text-ink-muted">
              <input
                type="checkbox"
                checked={allSelected}
                disabled={importing || selectable.length === 0}
                onChange={(event) => {
                  const selected = event.currentTarget.checked;
                  setItems((current) =>
                    current.map((item) =>
                      item.phase === 'ready' ? item : { ...item, selected },
                    ),
                  );
                }}
              />
              全选可导入网页
            </label>
          </div>

          <div className="space-y-3" aria-live="polite">
            {items.map((item) => (
              <article
                key={item.url}
                className="rounded-2xl border border-line bg-card p-4"
              >
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    className="mt-1 size-4 shrink-0 accent-[var(--color-accent)]"
                    checked={item.selected}
                    disabled={importing || item.phase === 'ready'}
                    aria-label={`选择 ${item.title}`}
                    onChange={(event) => {
                      const selected = event.currentTarget.checked;
                      updateItem(item.url, (current) => ({
                        ...current,
                        selected,
                      }));
                    }}
                  />
                  <div className="min-w-0 flex-1">
                    <SourceWebSearchResultLink result={item} />
                    <p className="mt-2 line-clamp-3 text-sm leading-5 text-ink-muted">
                      {item.snippet || '该结果没有摘要。导入后将提取网页正文。'}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs">
                      <span className="rounded-full bg-surface px-2 py-1 text-ink-muted">
                        {accessibilityCopy(item.accessibility)}
                      </span>
                      <span
                        className={`rounded-full px-2 py-1 ${
                          item.phase === 'ready'
                            ? 'bg-good/10 text-good'
                            : item.phase === 'failed'
                              ? 'bg-bad/10 text-bad'
                              : 'bg-surface text-ink-muted'
                        }`}
                      >
                        {item.phase === 'ready'
                          ? '已导入'
                          : item.phase === 'processing'
                            ? '正在导入'
                            : item.phase === 'failed'
                              ? '导入失败'
                              : '未导入'}
                      </span>
                    </div>
                    {item.error ? (
                      <p className="mt-2 text-xs text-bad" role="alert">
                        {item.error}
                      </p>
                    ) : null}
                  </div>
                  <span className="mt-0.5" aria-hidden="true">
                    {item.phase === 'ready' ? (
                      <CheckCircle size={20} className="text-good" />
                    ) : item.phase === 'processing' ? (
                      <SpinnerGap
                        size={20}
                        className="animate-spin text-ink-muted motion-reduce:animate-none"
                      />
                    ) : item.phase === 'failed' ? (
                      <WarningCircle size={20} className="text-bad" />
                    ) : null}
                  </span>
                </div>
              </article>
            ))}
          </div>

          <button
            type="button"
            disabled={importing || selectedCount === 0}
            onClick={() => void importSelected()}
            className="mt-4 min-h-12 w-full rounded-2xl bg-accent px-4 font-medium text-card hover:bg-accent-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:bg-surface-strong disabled:text-ink-faint"
          >
            {importing
              ? '正在导入所选网页'
              : `导入所选网页（${selectedCount}）`}
          </button>
        </section>
      ) : null}
    </div>
  );
}
