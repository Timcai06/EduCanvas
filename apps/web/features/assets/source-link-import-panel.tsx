'use client';

import {
  ArrowClockwise,
  CheckCircle,
  LinkSimple,
  SpinnerGap,
  WarningCircle,
} from '@phosphor-icons/react';
import { useRef, useState } from 'react';
import { LinkAssetClientError } from './link-client-contract';
import {
  LINK_IMPORT_CONCURRENCY,
  mapWithConcurrency,
  parseLinkImportInput,
} from './link-import-batch';
import { importWorkspaceLink } from './source-intake';
import type { AssetItem } from './assets-drawer';

type LinkPhase = 'queued' | 'processing' | 'ready' | 'failed';

interface LinkBatchItem {
  url: string;
  phase: LinkPhase;
  asset: AssetItem | null;
  error: string | null;
  retryable: boolean;
}

const phaseCopy: Record<LinkPhase, string> = {
  queued: '已加入导入队列',
  processing: '正在导入',
  ready: '已导入',
  failed: '处理失败',
};

function publicFailure(reason: unknown): {
  message: string;
  retryable: boolean;
} {
  return reason instanceof LinkAssetClientError
    ? { message: reason.message, retryable: reason.retryable }
    : { message: '暂时无法处理该链接。请稍后重试。', retryable: true };
}

function initialItem(url: string): LinkBatchItem {
  return {
    url,
    phase: 'queued',
    asset: null,
    error: null,
    retryable: false,
  };
}

/** 输入框加号中的批量网页来源入口；导入结果由用户确认完成后一次交回 Workspace。 */
export function SourceLinkImportPanel({
  onImported,
}: {
  onImported: (asset: AssetItem) => void;
}) {
  const [value, setValue] = useState('');
  const [items, setItems] = useState<readonly LinkBatchItem[]>([]);
  const [inputNotice, setInputNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const runningRef = useRef(false);

  const runBusy = async (work: () => Promise<void>) => {
    if (runningRef.current) return;
    runningRef.current = true;
    setBusy(true);
    try {
      await work();
    } finally {
      runningRef.current = false;
      setBusy(false);
    }
  };

  const updateItem = (
    url: string,
    update: (item: LinkBatchItem) => LinkBatchItem,
  ) => {
    setItems((current) =>
      current.map((item) => (item.url === url ? update(item) : item)),
    );
  };

  const importOne = async (url: string) => {
    updateItem(url, (item) => ({
      ...item,
      phase: 'processing',
      asset: null,
      error: null,
    }));
    try {
      const asset = await importWorkspaceLink(url);
      const phase: LinkPhase =
        asset.status === 'ready'
          ? 'ready'
          : asset.status === 'failed'
            ? 'failed'
            : asset.status === 'pending'
              ? 'queued'
              : 'processing';
      updateItem(url, (item) => ({
        ...item,
        phase,
        asset,
        error: phase === 'failed' ? '网页导入失败。请重试或上传 PDF。' : null,
        retryable: phase === 'failed',
      }));
    } catch (reason) {
      const failure = publicFailure(reason);
      updateItem(url, (item) => ({
        ...item,
        phase: 'failed',
        error: failure.message,
        retryable: failure.retryable,
      }));
    }
  };

  const beginImport = async () => {
    if (runningRef.current) return;
    const parsed = parseLinkImportInput(value);
    if (parsed.urls.length === 0) return;
    setInputNotice(
      parsed.overflowCount > 0
        ? `每次最多处理 10 个链接，已保留前 10 个并忽略 ${parsed.overflowCount} 个。`
        : null,
    );
    setItems(parsed.urls.map(initialItem));
    await runBusy(async () => {
      await mapWithConcurrency(parsed.urls, LINK_IMPORT_CONCURRENCY, importOne);
    });
  };

  const retryOne = async (item: LinkBatchItem) => {
    await importOne(item.url);
  };

  const retryAll = async () => {
    if (runningRef.current) return;
    const failed = items.filter(
      (item) => item.phase === 'failed' && item.retryable,
    );
    await runBusy(async () => {
      await mapWithConcurrency(failed, LINK_IMPORT_CONCURRENCY, async (item) =>
        retryOne(item),
      );
    });
  };

  const retrySingle = async (item: LinkBatchItem) => {
    await runBusy(async () => retryOne(item));
  };

  const active = busy;
  const imported = items.flatMap((item) => (item.asset ? [item.asset] : []));
  const retryableFailures = items.filter(
    (item) => item.phase === 'failed' && item.retryable,
  ).length;

  return (
    <div className="space-y-5">
      <div className="rounded-3xl border border-line bg-card p-5 shadow-[var(--shadow-float)]">
        <span className="grid size-11 place-items-center rounded-2xl bg-accent-soft text-accent">
          <LinkSimple size={23} aria-hidden="true" />
        </span>
        <h3 className="mt-4 font-display text-lg font-semibold text-ink">
          导入网页来源
        </h3>
        <p className="mt-1 text-sm leading-6 text-ink-muted">
          每行或用逗号分隔一个公开网页，最多 10
          个。网页会直接保存到当前笔记本并在后台提取正文。
        </p>
      </div>

      <label className="block" htmlFor="source-link-import-urls">
        <span className="mb-2 block text-sm font-medium text-ink">
          网页地址
        </span>
        <textarea
          id="source-link-import-urls"
          autoFocus
          value={value}
          disabled={active}
          rows={4}
          placeholder={
            'https://example.com/article\nhttps://example.org/report'
          }
          onChange={(event) => setValue(event.currentTarget.value)}
          className="ec-input w-full resize-y rounded-2xl px-4 py-3 text-sm text-ink"
        />
      </label>

      {items.length === 0 ? (
        <button
          type="button"
          disabled={busy || value.trim().length === 0}
          onClick={() => void beginImport()}
          className="min-h-12 w-full rounded-2xl bg-accent px-4 font-medium text-card transition-colors hover:bg-accent-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:bg-surface-strong disabled:text-ink-faint"
        >
          开始导入
        </button>
      ) : null}

      {inputNotice ? (
        <p className="text-sm text-warn" role="status">
          {inputNotice}
        </p>
      ) : null}

      {items.length > 0 ? (
        <div className="space-y-3" aria-label="链接处理状态">
          {items.map((item) => (
            <article
              key={item.url}
              className="rounded-2xl border border-line bg-card p-4"
            >
              <div className="flex items-start gap-3">
                <span className="mt-0.5 text-ink-muted" aria-hidden="true">
                  {item.phase === 'ready' ? (
                    <CheckCircle size={20} className="text-good" />
                  ) : item.phase === 'failed' ? (
                    <WarningCircle size={20} className="text-bad" />
                  ) : ['queued', 'processing'].includes(item.phase) ? (
                    <SpinnerGap
                      size={20}
                      className="animate-spin motion-reduce:animate-none"
                    />
                  ) : null}
                </span>
                <div className="min-w-0 flex-1">
                  <h4 className="truncate text-sm font-semibold text-ink">
                    {item.url}
                  </h4>
                  <p className="mt-0.5 truncate text-xs text-ink-faint">
                    {item.url}
                  </p>
                  <p
                    className={`mt-2 text-xs ${item.error ? 'text-bad' : 'text-ink-muted'}`}
                    role={item.error ? 'alert' : 'status'}
                  >
                    {item.error ?? phaseCopy[item.phase]}
                  </p>
                </div>
                {item.phase === 'failed' && item.retryable ? (
                  <button
                    type="button"
                    disabled={active}
                    onClick={() => void retrySingle(item)}
                    className="inline-flex min-h-8 items-center gap-1 rounded-xl px-2 text-xs font-medium text-accent hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
                  >
                    <ArrowClockwise size={14} aria-hidden="true" />
                    重试
                  </button>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      ) : null}

      {!active && retryableFailures > 1 ? (
        <button
          type="button"
          onClick={() => void retryAll()}
          className="min-h-11 w-full rounded-2xl border border-line px-4 text-sm font-medium text-ink hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          重试全部失败项（{retryableFailures}）
        </button>
      ) : null}

      {!active && imported.length > 0 ? (
        <button
          type="button"
          onClick={() => imported.forEach(onImported)}
          className="min-h-12 w-full rounded-2xl bg-accent px-4 font-medium text-card hover:bg-accent-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          完成，已导入 {imported.length} 个来源
        </button>
      ) : null}

      <p className="text-sm text-ink-muted">
        每个链接独立处理；单项失败不会中断其他网页。
      </p>
    </div>
  );
}
