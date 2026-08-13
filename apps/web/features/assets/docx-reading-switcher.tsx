'use client';

import type { AssetPreview } from './asset-preview-contract';
import { DocxPreview } from './preview/docx-preview';
import { ReadingViewSwitcher } from './reading-view-switcher';

type DocxPreviewData = Extract<AssetPreview, { kind: 'docx' }>;

/**
 * ADR-0026 决定 6 的 DOCX 阅读入口（与 PDF 同构，共享切换壳）：默认原件
 * 视图（mammoth 原格式预览），structured/degraded 派生可用时显式切换；
 * 下载入口始终保留（决定 1）。structured 时服务端不跑 mammoth（content
 * 为空），原件视图降级为占位说明 + 下载，不渲染空白页。
 */
export function DocxReadingSwitcher({
  preview,
  canDownload,
  initialView,
}: {
  preview: DocxPreviewData;
  canDownload: boolean;
  initialView?: 'original' | 'structured';
}) {
  return (
    <ReadingViewSwitcher
      representation={preview.representation}
      initialView={initialView}
      renderOriginal={() => (
        <div className="m-4 space-y-4">
          {preview.content ? (
            <DocxPreview html={preview.content} warnings={preview.warnings} />
          ) : (
            <div className="rounded-2xl border border-line bg-card p-4 text-sm text-ink-muted">
              原件已保留，可下载查看。
            </div>
          )}
          {canDownload ? (
            <div className="flex justify-center">
              <a
                href={preview.downloadUrl}
                download
                className="inline-flex min-h-9 items-center rounded-full border border-line px-4 text-xs font-medium text-ink transition-colors hover:bg-surface-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                下载原件（{preview.fileName}）
              </a>
            </div>
          ) : null}
        </div>
      )}
    />
  );
}
