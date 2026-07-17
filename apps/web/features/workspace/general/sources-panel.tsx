'use client';

import type { AssetItem } from '@/features/assets/assets-drawer';
import { FileArrowUp, FilePdf, Image as ImageIcon } from '@phosphor-icons/react';

/**
 * 侧栏来源区(NotebookLM 式常驻,U2 v1):逐条勾选决定进入下一轮上下文,
 * 与既有 Sheet 抽屉共享同一份 assets 状态——这里只是常驻投影,不新增数据路径。
 * 网页链接与搜索结果来源随 M3 加入同一列表。
 */
export function SourcesPanel({
  assets,
  onToggle,
  onUpload,
}: {
  assets: readonly AssetItem[];
  onToggle: (id: string) => void;
  onUpload: (kind: 'document' | 'image') => void;
}) {
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
        </div>
      </div>
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
              {asset.kind === 'image' ? (
                <ImageIcon aria-hidden="true" size={14} className="shrink-0 text-ink-faint" />
              ) : (
                <FilePdf aria-hidden="true" size={14} className="shrink-0 text-ink-faint" />
              )}
              <span className="min-w-0 flex-1 truncate">{asset.label}</span>
            </label>
          </li>
        ))}
        {assets.length === 0 ? (
          <li className="px-3 py-2 text-xs text-ink-faint">
            还没有来源。上传 PDF 或图片,回答会基于它们。
          </li>
        ) : null}
      </ul>
    </div>
  );
}
