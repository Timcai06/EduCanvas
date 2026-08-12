'use client';

import { CanvasHost } from '@/features/canvas/canvas-host';
import { MessageMarkdown } from '@/features/chat/markdown';
import { Trash } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { deleteAsset, loadAssetPreview } from './asset-client';
import type { AssetPreview } from './asset-preview-contract';
import type { AssetItem } from './assets-drawer';
import { DocxReadingSwitcher } from './docx-reading-switcher';
import { PdfReadingSwitcher } from './pdf-reading-switcher';

/**
 * 来源预览面板：PDF（pdf.js 翻页+缩放）、DOCX（mammoth HTML）、
 * 图片（同源 img）、Markdown、纯文本。
 * 复用 CanvasHost 提供统一的标题栏、全屏切换与关闭交互。
 * 删除为显式二次确认的软删除。
 */
export function SourcePreviewPanel({
  asset,
  isFull,
  onToggleFull,
  onClose,
  onDeleted,
}: {
  asset: AssetItem;
  isFull: boolean;
  onToggleFull: () => void;
  onClose: () => void;
  onDeleted: (assetId: string) => void;
}) {
  const [preview, setPreview] = useState<AssetPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!asset.selectable) return;
    let active = true;
    void loadAssetPreview(asset.id)
      .then((value) => {
        if (active) setPreview(value);
      })
      .catch((reason: unknown) => {
        if (active) {
          setError(
            reason instanceof Error ? reason.message : '暂时无法预览这个来源。',
          );
        }
      });
    return () => {
      active = false;
    };
  }, [asset.id, asset.selectable]);

  const remove = () => {
    if (!deleteArmed) {
      setDeleteArmed(true);
      return;
    }
    setDeleting(true);
    setError(null);
    void deleteAsset(asset.id)
      .then(() => onDeleted(asset.id))
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : '删除失败。');
        setDeleting(false);
        setDeleteArmed(false);
      });
  };

  return (
    <CanvasHost
      ariaLabel="来源预览"
      title={asset.label}
      closeLabel="关闭来源预览"
      onClose={onClose}
      isFull={isFull}
      onToggleFull={onToggleFull}
    >
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-4 py-2.5">
          <p className="text-xs text-ink-muted">
            当前Notebook来源 · {asset.enabled ? '已用于对话' : '未用于对话'}
          </p>
          <button
            type="button"
            disabled={deleting}
            onClick={remove}
            onBlur={() => setDeleteArmed(false)}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 text-xs font-medium text-cinnabar transition-colors hover:bg-cinnabar-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cinnabar disabled:opacity-60"
          >
            <Trash size={15} />
            {deleting ? '删除中…' : deleteArmed ? '再次点击确认' : '删除来源'}
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto bg-surface/30">
          {!asset.selectable ? (
            <div className="m-4 rounded-2xl border border-line bg-card p-4 text-sm text-ink-muted">
              {asset.status === 'failed'
                ? '这个来源处理失败，暂时没有可预览内容；你可以删除后重新添加。'
                : '这个来源仍在处理中，完成后即可预览。'}
            </div>
          ) : error ? (
            <div className="m-4 rounded-2xl border border-cinnabar/25 bg-cinnabar-soft p-4 text-sm text-cinnabar">
              {error}
            </div>
          ) : !preview ? (
            <div className="m-4 h-52 animate-pulse rounded-2xl bg-surface-strong" />
          ) : preview.kind === 'pdf' ? (
            /* ADR-0026 决定 6：默认原件预览，显式切换结构化/降级阅读。 */
            <PdfReadingSwitcher preview={preview} />
          ) : preview.kind === 'image' && preview.fileUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={preview.fileUrl}
              alt={preview.fileName}
              className="mx-auto max-h-full max-w-full rounded-2xl object-contain p-4 shadow-[var(--shadow-float)]"
            />
          ) : preview.kind === 'docx' ? (
            /* ADR-0026 决定 6：默认原件预览（mammoth），结构化/降级显式切换，
               下载入口始终保留。与 SourceResourceRenderer 共用同一组件，避免
               两条渲染路径行为漂移。 */
            <DocxReadingSwitcher preview={preview} />
          ) : preview.kind === 'markdown' && preview.content ? (
            <article className="mx-auto max-w-3xl rounded-2xl bg-card p-5 shadow-[var(--shadow-float)]">
              <MessageMarkdown text={preview.content} />
            </article>
          ) : preview.kind === 'text' && preview.content ? (
            <pre className="mx-auto max-w-3xl whitespace-pre-wrap break-words rounded-2xl bg-card p-5 font-mono text-sm leading-6 text-ink shadow-[var(--shadow-float)]">
              {preview.content}
            </pre>
          ) : preview.kind === 'audio' ? (
            <div className="m-4 space-y-4">
              <audio
                controls
                src={preview.fileUrl}
                className="w-full"
                preload="metadata"
              >
                您的浏览器不支持音频播放。
              </audio>
              {preview.transcription ? (
                <div className="rounded-2xl bg-card p-5 shadow-[var(--shadow-float)]">
                  <p className="mb-2 text-xs font-medium text-ink-muted">
                    转录文本
                    {preview.transcription.language
                      ? ` · ${preview.transcription.language}`
                      : ''}
                    {preview.transcription.durationSeconds
                      ? ` · ${Math.round(preview.transcription.durationSeconds)}秒`
                      : ''}
                  </p>
                  <article className="text-sm leading-6 text-ink">
                    <MessageMarkdown text={preview.transcription.text} />
                  </article>
                </div>
              ) : (
                <div className="rounded-2xl border border-line bg-card p-4 text-sm text-ink-muted">
                  转录处理中或暂不可用。
                </div>
              )}
            </div>
          ) : preview.kind === 'video' ? (
            <div className="m-4 space-y-4">
              <video
                controls
                src={preview.fileUrl}
                className="max-h-[70vh] w-full rounded-2xl bg-black"
                preload="metadata"
              >
                您的浏览器不支持视频播放。
              </video>
              {preview.transcription ? (
                <div className="rounded-2xl bg-card p-5 shadow-[var(--shadow-float)]">
                  <p className="mb-2 text-xs font-medium text-ink-muted">
                    视频转录
                    {preview.transcription.language
                      ? ` · ${preview.transcription.language}`
                      : ''}
                    {preview.transcription.durationSeconds
                      ? ` · ${Math.round(preview.transcription.durationSeconds)}秒`
                      : ''}
                  </p>
                  <article className="text-sm leading-6 text-ink">
                    <MessageMarkdown text={preview.transcription.text} />
                  </article>
                </div>
              ) : (
                <div className="rounded-2xl border border-line bg-card p-4 text-sm text-ink-muted">
                  这个视频没有可用转录；仍可播放原视频。
                </div>
              )}
              {preview.derivatives.keyframes === 'failed' ? (
                <div className="rounded-2xl border border-cinnabar/25 bg-cinnabar-soft p-4 text-sm text-cinnabar">
                  关键帧提取失败，但不影响视频播放和已有转录。当前还没有单独重试入口；需要时可删除后重新上传。
                </div>
              ) : null}
            </div>
          ) : (
            <div className="m-4 rounded-2xl border border-line bg-card p-4 text-sm text-ink-muted">
              暂不支持预览此来源。
            </div>
          )}
        </div>
      </div>
    </CanvasHost>
  );
}
