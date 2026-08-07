'use client';

import { CanvasHost } from '@/features/canvas/canvas-host';
import { CanvasShellStatus } from '@/features/canvas/canvas-shell-status';
import { MessageMarkdown } from '@/features/chat/markdown';
import dynamic from 'next/dynamic';
import { useEffect, useState, type ComponentType } from 'react';
import { loadAssetPreview } from './asset-client';
import type { AssetPreview } from './asset-preview-contract';
import type { CanvasResource } from '@educanvas/canvas-protocol';
import { resolveSourceRendererState } from './source-resource-renderer-state';
import type { CanvasResourceRendererProps } from '../canvas/canvas-resource-registry';

const PdfPreview = dynamic(
  () => import('./preview/pdf-preview').then((mod) => mod.PdfPreview),
  { ssr: false },
);
import { DocxPreview } from './preview/docx-preview';

/**
 * 来源内容渲染器：统一处理 PDF、图片、DOCX、Markdown、纯文本、音频、视频。
 * 只接收浏览器安全的 CanvasResource，内容通过既有同源 preview 端点读取。
 *
 * 状态：loading / empty / ready / failed / unavailable / denied。
 * 错误状态使用 CanvasShellStatus，不暴露内部堆栈或对象键。
 */
export function SourceResourceRenderer({
  resource,
  Renderer,
  isFull,
  onToggleFull,
  onClose,
  canExitFullscreen,
}: {
  resource: CanvasResource;
  Renderer: ComponentType<CanvasResourceRendererProps>;
  isFull: boolean;
  onToggleFull: () => void;
  onClose: () => void;
  /** landing 强制全屏时置 false，Escape 直接关闭（见 CanvasHost）。 */
  canExitFullscreen?: boolean;
}) {
  return (
    <CanvasHost
      ariaLabel="来源预览"
      title={resource.title}
      closeLabel="关闭来源预览"
      onClose={onClose}
      isFull={isFull}
      onToggleFull={onToggleFull}
      canExitFullscreen={canExitFullscreen}
    >
      <Renderer resource={resource} />
    </CanvasHost>
  );
}

/**
 * Registry 可直接引用的来源内容体。CanvasHost 由页面组合层统一提供，避免
 * registry Renderer 自己创建第二层宿主。
 */
export function SourceResourceRendererBody({
  resource,
}: {
  resource: CanvasResource;
}) {
  const [retrySequence, setRetrySequence] = useState(0);
  const loadKey = `${resource.resourceId}:${resource.version?.versionId ?? 'none'}:${retrySequence}`;
  const [result, setResult] = useState<{
    readonly loadKey: string;
    readonly preview: AssetPreview | null;
    readonly failed: boolean;
  }>({ loadKey: '', preview: null, failed: false });

  useEffect(() => {
    if (resource.status !== 'ready') return;
    let active = true;
    void loadAssetPreview(resource.resourceId)
      .then((value) => {
        if (active) setResult({ loadKey, preview: value, failed: false });
      })
      .catch(() => {
        if (active) {
          setResult({ loadKey, preview: null, failed: true });
        }
      });
    return () => {
      active = false;
    };
  }, [loadKey, resource.resourceId, resource.status]);

  const preview = result.loadKey === loadKey ? result.preview : null;
  const previewFailed = result.loadKey === loadKey && result.failed;
  return (
    <SourceResourceRendererContent
      resource={resource}
      preview={preview}
      previewFailed={previewFailed}
      onRetry={() => setRetrySequence((value) => value + 1)}
    />
  );
}

export function SourceResourceRendererContent({
  resource,
  preview,
  previewFailed,
  onRetry,
}: {
  resource: CanvasResource;
  preview: AssetPreview | null;
  previewFailed: boolean;
  onRetry: () => void;
}) {
  const stateInfo = resolveSourceRendererState(
    resource,
    preview,
    previewFailed,
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {stateInfo.state === 'loading' && '正在加载来源内容…'}
        {stateInfo.state === 'ready' && '来源内容已加载。'}
        {stateInfo.state === 'failed' &&
          (stateInfo.errorMessage ?? '加载失败。')}
        {stateInfo.state === 'unavailable' &&
          (stateInfo.errorMessage ?? '来源不可用。')}
        {stateInfo.state === 'forbidden' && '没有权限预览这个来源。'}
        {stateInfo.state === 'empty' && '这个来源没有可预览内容。'}
      </div>

      {stateInfo.state === 'loading' ? (
        <div
          role="status"
          aria-busy="true"
          className="min-h-0 flex-1 overflow-auto"
        >
          <div className="m-4 h-52 animate-pulse rounded-2xl bg-surface-strong" />
        </div>
      ) : stateInfo.state === 'failed' || stateInfo.state === 'forbidden' ? (
        <CanvasShellStatus
          status={stateInfo.state}
          title={stateInfo.state === 'forbidden' ? '无权访问' : '加载失败'}
          description={stateInfo.errorMessage ?? '暂时无法预览这个来源。'}
          onRetry={stateInfo.state === 'failed' ? onRetry : undefined}
          retryLabel="重试"
        />
      ) : stateInfo.state === 'unavailable' ? (
        <CanvasShellStatus
          status="unavailable"
          title="来源不可用"
          description={stateInfo.errorMessage ?? '这个来源不可用。'}
        />
      ) : stateInfo.state === 'empty' ? (
        <CanvasShellStatus
          status="unavailable"
          title="无内容"
          description="这个来源没有可预览内容。"
        />
      ) : preview ? (
        <div className="min-h-0 flex-1 overflow-auto bg-surface/30">
          {preview.kind === 'pdf' && preview.fileUrl ? (
            <PdfPreview fileUrl={preview.fileUrl} />
          ) : preview.kind === 'image' && preview.fileUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={preview.fileUrl}
              alt={resource.title}
              className="mx-auto max-h-full max-w-full rounded-2xl object-contain p-4 shadow-[var(--shadow-float)]"
            />
          ) : preview.kind === 'docx' && preview.content ? (
            <DocxPreview html={preview.content} warnings={preview.warnings} />
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
                aria-label={`播放音频：${resource.title}`}
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
                <div
                  role="status"
                  className="rounded-2xl border border-line bg-card p-4 text-sm text-ink-muted"
                >
                  音频文字稿不可用；仍可播放原音频。
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
                aria-label={`播放视频：${resource.title}`}
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
                <div
                  role="status"
                  className="rounded-2xl border border-line bg-card p-4 text-sm text-ink-muted"
                >
                  {preview.derivatives.transcription === 'processing'
                    ? '视频文字稿正在处理中；当前仍可播放原视频。'
                    : '视频文字稿不可用；仍可播放原视频。'}
                </div>
              )}
            </div>
          ) : (
            <div className="m-4 rounded-2xl border border-line bg-card p-4 text-sm text-ink-muted">
              暂不支持预览此来源。
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
