'use client';

import { importLinkAsset } from '@/features/assets/asset-client';
import type { AssetItem } from '@/features/assets/assets-drawer';
import { AssetsDrawer } from '@/features/assets/assets-drawer';
import {
  ArrowRight,
  FilePdf,
  Image as ImageIcon,
  LinkSimple,
} from '@phosphor-icons/react';
import { useState } from 'react';

export const STUDIO_INPUT_OPTIONS = [
  '来源总览',
  '上传 PDF',
  '上传图片',
  '导入网页',
] as const;

/**
 * Studio 文件输入详情区。这里只编排已有 Asset 能力；归属和可选择状态仍由服务端
 * Space 投影决定，前端不能把未就绪文件伪装为可用来源。
 */
export function StudioInputPanel({
  selectedIndex,
  assets,
  onToggle,
  onUpload,
  onImported,
}: {
  selectedIndex: number;
  assets: readonly AssetItem[];
  onToggle: (id: string) => void;
  onUpload: (kind: 'document' | 'image') => void;
  onImported: (asset: AssetItem) => void;
}) {
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
      })
      .catch((reason: unknown) => {
        setLinkError(
          reason instanceof Error ? reason.message : '暂时无法导入链接。',
        );
      })
      .finally(() => setLinkBusy(false));
  };

  if (selectedIndex === 0) {
    return (
      <div>
        <PanelHeading
          eyebrow="Notebook sources"
          title="当前笔记本的来源"
          description={`${assets.length} 项资料。勾选只影响下一轮使用哪些来源，不会改变它们所属的笔记本。`}
        />
        <div className="mt-6">
          <AssetsDrawer assets={assets} onToggle={onToggle} />
        </div>
      </div>
    );
  }

  if (selectedIndex === 1 || selectedIndex === 2) {
    const image = selectedIndex === 2;
    const Icon = image ? ImageIcon : FilePdf;
    return (
      <div>
        <PanelHeading
          eyebrow="File input"
          title={image ? '添加图片来源' : '添加 PDF 来源'}
          description={
            image
              ? '支持 PNG、JPEG 和 WebP，最大 10MB。图片会保存到当前笔记本。'
              : '支持带可复制文字的 PDF，最大 10MB。解析后的文字会成为长期来源。'
          }
        />
        <button
          type="button"
          onClick={() => onUpload(image ? 'image' : 'document')}
          className="group mt-8 flex min-h-28 w-full items-center gap-4 rounded-3xl border border-line bg-surface/65 p-5 text-left transition-[border-color,background-color,transform] hover:-translate-y-0.5 hover:border-accent/45 hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-accent-soft text-accent">
            <Icon aria-hidden="true" size={27} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-display text-lg font-semibold text-ink">
              选择{image ? '图片' : 'PDF'}
            </span>
            <span className="mt-1 block text-sm text-ink-muted">
              上传后进入来源总览，处理状态不会被隐藏。
            </span>
          </span>
          <ArrowRight
            aria-hidden="true"
            size={19}
            className="text-accent transition-transform group-hover:translate-x-1"
          />
        </button>
      </div>
    );
  }

  return (
    <div>
      <PanelHeading
        eyebrow="Web source"
        title="导入网页"
        description="服务端读取公开页面正文并保存为当前笔记本来源；不能读取时会诚实失败。"
      />
      <label className="mt-8 block">
        <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-ink-muted">
          网页地址
        </span>
        <span className="flex gap-2">
          <input
            type="url"
            value={linkValue}
            placeholder="https://…"
            disabled={linkBusy}
            onChange={(event) => setLinkValue(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') submitLink();
            }}
            className="min-w-0 flex-1 rounded-2xl border border-line bg-surface px-4 py-3 text-sm text-ink outline-none transition-colors focus-visible:border-accent/55 focus-visible:ring-2 focus-visible:ring-accent/25"
          />
          <button
            type="button"
            onClick={submitLink}
            disabled={linkBusy || linkValue.trim().length === 0}
            className="inline-flex min-h-12 shrink-0 items-center gap-2 rounded-2xl bg-accent px-5 text-sm font-semibold text-card transition-colors hover:bg-accent-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:bg-surface-strong disabled:text-ink-faint"
          >
            <LinkSimple aria-hidden="true" size={18} />
            {linkBusy ? '导入中…' : '导入'}
          </button>
        </span>
      </label>
      <p
        role={linkError ? 'alert' : undefined}
        className={`mt-3 min-h-5 text-sm ${linkError ? 'text-bad' : 'text-ink-muted'}`}
      >
        {linkError ?? '成功后会出现在来源总览，并默认用于后续对话。'}
      </p>
    </div>
  );
}

function PanelHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-accent">
        {eyebrow}
      </p>
      <h3 className="mt-2 font-display text-2xl font-semibold tracking-tight text-ink">
        {title}
      </h3>
      <p className="mt-2 max-w-xl text-sm leading-6 text-ink-muted">
        {description}
      </p>
    </div>
  );
}
