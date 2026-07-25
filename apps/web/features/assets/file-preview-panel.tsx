'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowsOut, ArrowsIn, X } from '@phosphor-icons/react';
import { fetchAssetPreview, type PreviewData } from './asset-client';
import { PdfPreview } from './preview/pdf-preview';
import { DocxPreview } from './preview/docx-preview';
import { MarkdownPreview } from './preview/markdown-preview';
import { TextPreview } from './preview/text-preview';

/**
 * 文件预览面板——桌面端在对话右侧作为分栏列展开，窄屏占满宽度。
 * 支持全屏切换：全屏时 fixed 铺满视口，z-30（低于顶栏 dialog 的 z-40）。
 *
 * 状态机：idle → loading → ready | error
 */
export function FilePreviewPanel({
  asset,
  onClose,
}: {
  asset: { id: string; label: string };
  onClose: () => void;
}) {
  const [data, setData] = useState<PreviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isFull, setIsFull] = useState(false);
  const rootRef = useRef<HTMLElement>(null);

  const load = useCallback(async (assetId: string) => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchAssetPreview(assetId));
    } catch (e) {
      setError(e instanceof Error ? e.message : '预览加载失败。');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(asset.id);
  }, [asset.id, load]);

  /* Esc 关闭 / 退出全屏 */
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      if (isFull) {
        setIsFull(false);
      } else {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isFull, onClose]);

  /* 全屏时锁定 body 滚动 */
  useEffect(() => {
    if (!isFull) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [isFull]);

  const renderContent = () => {
    if (loading) {
      return (
        <div className="flex items-center justify-center p-8">
          <p className="text-sm text-ink-muted">正在准备预览…</p>
        </div>
      );
    }
    if (error) {
      return (
        <div className="flex items-center justify-center p-8">
          <p className="text-sm text-ink-muted" role="alert">
            {error}
          </p>
        </div>
      );
    }
    if (!data) return null;

    const { mimeType } = data;
    if (mimeType === 'application/pdf' && data.fileUrl) {
      return <PdfPreview fileUrl={data.fileUrl} />;
    }
    if (
      mimeType ===
        'application/vnd.openxmlformats-officedocument.wordprocessingml' &&
      data.content
    ) {
      return (
        <DocxPreview html={data.content} warnings={data.warnings} />
      );
    }
    if (mimeType === 'text/markdown' && data.content !== undefined) {
      return <MarkdownPreview content={data.content} />;
    }
    if (mimeType === 'text/plain' && data.content !== undefined) {
      return <TextPreview content={data.content} />;
    }
    return (
      <div className="flex items-center justify-center p-8">
        <p className="text-sm text-ink-muted">暂不支持预览此文件格式。</p>
      </div>
    );
  };

  const panel = (
    <>
      {/* 内容区 */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {renderContent()}
      </div>
      {/* 悬浮控制栏：右下角，不占内容区空间，不和顶栏重叠 */}
      <div className="absolute right-3 top-3 flex items-center gap-1 rounded-full border border-line bg-card/90 px-1.5 py-1 shadow-[var(--shadow-float)] backdrop-blur">
        <span className="ml-2 max-w-32 truncate text-xs text-ink-muted">
          {asset.label}
        </span>
        <button
          type="button"
          onClick={() => setIsFull((v) => !v)}
          aria-label={isFull ? '退出全屏' : '全屏'}
          className="grid size-7 shrink-0 place-items-center rounded-full text-ink-muted transition-colors hover:bg-surface hover:text-ink"
        >
          {isFull ? <ArrowsIn size={14} /> : <ArrowsOut size={14} />}
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭预览"
          className="grid size-7 shrink-0 place-items-center rounded-full text-ink-muted transition-colors hover:bg-surface hover:text-ink"
        >
          <X size={14} weight="bold" />
        </button>
      </div>
    </>
  );

  /* 全屏：fixed 铺满，z-30（低于顶栏 dialog z-40，高于普通内容） */
  if (isFull) {
    return (
      <section
        ref={rootRef}
        role="dialog"
        aria-label={`${asset.label} 预览（全屏）`}
        aria-modal
        className="fixed inset-0 z-50 flex flex-col bg-canvas relative"
      >
        {panel}
      </section>
    );
  }

  /* 分栏模式 */
  return (
    <section
      role="region"
      aria-label={`${asset.label} 预览`}
      className="flex min-h-0 flex-1 flex-col border-l border-line bg-canvas relative lg:min-w-0 lg:rounded-l-3xl lg:border lg:border-line lg:shadow-[var(--shadow-float)]"
    >
      {panel}
    </section>
  );
}
