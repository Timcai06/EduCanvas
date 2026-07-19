'use client';

import type { AssetItem } from '@/features/assets/assets-drawer';
import { importLinkAsset } from '@/features/assets/asset-client';
import {
  FileArrowUp,
  FilePdf,
  Image as ImageIcon,
  LinkSimple,
} from '@phosphor-icons/react';
import { useState } from 'react';

/**
 * 当前笔记本的来源区:Asset 归属由服务端 Space 决定，逐条勾选只决定
 * 下一轮使用哪些来源，不改变资料归属，也不把长期来源降级为本轮附件。
 * 网页链接与搜索结果来源随 M3 加入同一列表。
 */
export function SourcesPanel({
  assets,
  onToggle,
  onUpload,
  onImported,
}: {
  assets: readonly AssetItem[];
  onToggle: (id: string) => void;
  onUpload: (kind: 'document' | 'image') => void;
  onImported: (asset: AssetItem) => void;
}) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkValue, setLinkValue] = useState('');
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);

  const submitLink = () => {
    const url = linkValue.trim();
    if (!url || linkBusy) return;
    setLinkBusy(true);
    setLinkError(null);
    importLinkAsset({ url })
      .then((asset) => {
        onImported(asset);
        setLinkValue('');
        setLinkOpen(false);
      })
      .catch((reason: unknown) => {
        setLinkError(
          reason instanceof Error ? reason.message : '暂时无法导入链接。',
        );
      })
      .finally(() => setLinkBusy(false));
  };

  return (
    <div className="flex min-h-0 flex-col border-t border-line/60">
      <div className="flex items-center justify-between px-5 pt-3 pb-1">
        <p className="text-xs font-medium text-ink-faint">来源</p>
        <div className="flex gap-1">
          <button
            type="button"
            aria-label="上传 PDF 来源"
            title="上传 PDF"
            onClick={() => onUpload('document')}
            className="grid size-7 place-items-center rounded-full text-ink-faint transition-colors hover:bg-surface hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <FileArrowUp aria-hidden="true" size={14} />
          </button>
          <button
            type="button"
            aria-label="上传图片来源"
            title="上传图片"
            onClick={() => onUpload('image')}
            className="grid size-7 place-items-center rounded-full text-ink-faint transition-colors hover:bg-surface hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <ImageIcon aria-hidden="true" size={14} />
          </button>
          <button
            type="button"
            aria-label="添加网页链接来源"
            title="添加链接"
            onClick={() => setLinkOpen((value) => !value)}
            className="grid size-7 place-items-center rounded-full text-ink-faint transition-colors hover:bg-surface hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <LinkSimple aria-hidden="true" size={14} />
          </button>
        </div>
      </div>
      {linkOpen ? (
        <div className="px-4 pb-2">
          <div className="flex gap-1.5">
            <input
              value={linkValue}
              placeholder="https://…"
              disabled={linkBusy}
              onChange={(event) => setLinkValue(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') submitLink();
              }}
              aria-label="网页链接"
              className="min-w-0 flex-1 rounded-full border border-line bg-surface px-3 py-1.5 text-xs text-ink outline-none focus-visible:border-accent/55"
            />
            <button
              type="button"
              onClick={submitLink}
              disabled={linkBusy || linkValue.trim().length === 0}
              className="shrink-0 rounded-full bg-accent px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-accent-strong disabled:bg-surface-strong disabled:text-ink-faint"
            >
              {linkBusy ? '导入中…' : '导入'}
            </button>
          </div>
          {linkError ? (
            <p className="mt-1 px-1 text-xs text-bad">{linkError}</p>
          ) : null}
        </div>
      ) : null}
      <ul className="max-h-56 space-y-0.5 overflow-y-auto px-2 pb-3">
        {assets.map((asset) => (
          <li key={asset.id}>
            <label
              className={`flex min-h-9 cursor-pointer items-center gap-2.5 rounded-full px-3 text-[13px] transition-colors hover:bg-surface ${
                asset.enabled ? 'text-ink' : 'text-ink-muted'
              } ${asset.selectable ? '' : 'cursor-default opacity-60'}`}
            >
              <input
                type="checkbox"
                checked={asset.enabled}
                disabled={!asset.selectable}
                onChange={() => onToggle(asset.id)}
                className="size-3.5 shrink-0 accent-[var(--color-accent)]"
              />
              {asset.kind === 'link' ? (
                <LinkSimple
                  aria-hidden="true"
                  size={14}
                  className="shrink-0 text-ink-faint"
                />
              ) : asset.kind === 'image' ? (
                <ImageIcon
                  aria-hidden="true"
                  size={14}
                  className="shrink-0 text-ink-faint"
                />
              ) : (
                <FilePdf
                  aria-hidden="true"
                  size={14}
                  className="shrink-0 text-ink-faint"
                />
              )}
              <span className="min-w-0 flex-1 truncate">{asset.label}</span>
            </label>
          </li>
        ))}
        {assets.length === 0 ? (
          <li className="px-3 py-2 text-xs text-ink-faint">
            当前笔记本还没有来源。上传 PDF、图片或网页链接后，后续回答都能使用它们。
          </li>
        ) : null}
      </ul>
    </div>
  );
}
