'use client';

import { ArrowLeft, PencilCircle, X } from '@phosphor-icons/react';
import { useEffect, useState, type CSSProperties } from 'react';
import { ArtifactCanvasContent } from '@/features/canvas/artifact-canvas-content';
import {
  fetchArtifactDetail,
  type ArtifactDetail,
} from '@/features/canvas/artifact-client';
import { resolveArtifactContentView } from '@/features/canvas/artifact-content-view';
import { isShellRenderedArtifactResource } from '@/features/canvas/artifact-shell-rendering';
import { fetchCanvasResource } from '@/features/canvas/canvas-resource-client';
import { CanvasShellStatus } from '@/features/canvas/canvas-shell-status';
import { selectWebCanvasResourceRenderer } from '@/features/canvas/web-canvas-resource-registry';
import {
  isRetryableResourceError,
  type ResourceError,
} from '@/features/canvas/resource-error';
import type { CanvasResource } from '@educanvas/canvas-protocol';
import type { LiveVoiceAnnotationDraft } from './live-voice-bring-back';

export type LiveVoicePreviewTarget =
  | {
      readonly kind: 'source';
      readonly id: string;
      readonly title: string;
      readonly versionId?: string | null;
      readonly previewUrl?: string | null;
    }
  | { readonly kind: 'artifact'; readonly id: string; readonly title: string };

type PreviewState =
  | { readonly status: 'loading' }
  | { readonly status: 'failed'; readonly error: ResourceError }
  | { readonly status: 'source'; readonly resource: CanvasResource }
  | { readonly status: 'artifact'; readonly detail: ArtifactDetail };

/**
 * Live 内的只读资源窗口复用 Canvas 已验证的 Renderer，不复制 MIME 或 Artifact
 * 分发逻辑。关闭窗口只回到语音舞台，不退出会话。
 */
export function LiveVoiceResourcePreview({
  target,
  scopeKey,
  annotations = [],
  onAnnotateAsset,
  onClose,
}: {
  readonly target: LiveVoicePreviewTarget;
  readonly scopeKey: string;
  readonly annotations?: readonly LiveVoiceAnnotationDraft[];
  readonly onAnnotateAsset?: (draft: LiveVoiceAnnotationDraft) => void;
  readonly onClose: () => void;
}) {
  const [reloadSequence, setReloadSequence] = useState(0);
  const [state, setState] = useState<PreviewState>({ status: 'loading' });
  const [annotating, setAnnotating] = useState(false);
  const [previewAspectRatio, setPreviewAspectRatio] = useState(4 / 3);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const request =
      target.kind === 'source'
        ? fetchCanvasResource('source', target.id, {
            signal: controller.signal,
          }).then((resource) => ({
            status: 'source' as const,
            resource,
          }))
        : fetchCanvasResource('artifact', target.id, {
            signal: controller.signal,
          }).then(async (resource) => {
            const shellRendered = isShellRenderedArtifactResource(resource);
            const selection = selectWebCanvasResourceRenderer(resource);
            if (!shellRendered && selection.kind === 'unavailable') {
              throw {
                kind: 'unavailable',
                message: '这个产物没有兼容的安全渲染器。',
              } satisfies ResourceError;
            }
            const detail = await fetchArtifactDetail(target.id, undefined, {
              signal: controller.signal,
            });
            return {
              status: 'artifact' as const,
              detail: { ...detail, canvasResource: resource },
            };
          });
    void request
      .then((nextState) => {
        if (active) setState(nextState);
      })
      .catch((reason: unknown) => {
        if (!active || controller.signal.aborted) return;
        const error =
          reason &&
          typeof reason === 'object' &&
          'kind' in reason &&
          'message' in reason
            ? (reason as ResourceError)
            : { kind: 'failed' as const, message: '暂时无法打开这个资源。' };
        setState({ status: 'failed', error });
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [reloadSequence, scopeKey, target.id, target.kind]);

  const sourceSelection =
    state.status === 'source'
      ? selectWebCanvasResourceRenderer(state.resource)
      : null;
  const SourceRenderer =
    sourceSelection?.kind === 'available' ? sourceSelection.Renderer : null;
  return (
    <section
      data-live-resource-preview
      aria-label={`预览 ${target.title}`}
      className="live-voice-resource-preview"
    >
      <header>
        <button type="button" onClick={onClose} aria-label="返回 Live Voice">
          <ArrowLeft size={18} />
        </button>
        <div>
          <span>{target.kind === 'source' ? '资料预览' : '产物预览'}</span>
          <p>{target.title}</p>
        </div>
        {target.kind === 'source' && target.previewUrl && onAnnotateAsset ? (
          <button
            type="button"
            aria-pressed={annotating}
            aria-label={annotating ? '退出圈点模式' : '在原图上圈点'}
            onClick={() => setAnnotating((value) => !value)}
          >
            <PencilCircle size={18} />
          </button>
        ) : null}
        <button type="button" onClick={onClose} aria-label="关闭预览">
          <X size={18} />
        </button>
      </header>
      <div className="live-voice-resource-preview__body">
        {target.kind === 'source' &&
        target.previewUrl &&
        annotating &&
        onAnnotateAsset ? (
          <div className="live-voice-preview-annotation">
            <p>轻点原图，把这一处圈点带回书案。</p>
            <button
              type="button"
              className="live-voice-preview-annotation__surface"
              style={
                {
                  '--live-preview-image-ratio': previewAspectRatio,
                } as CSSProperties
              }
              aria-label={`在 ${target.title} 上圈点`}
              onClick={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                const centerX = (event.clientX - rect.left) / rect.width;
                const centerY = (event.clientY - rect.top) / rect.height;
                const width = 0.18;
                const height = 0.13;
                onAnnotateAsset({
                  clientId: crypto.randomUUID(),
                  resourceKind: 'source',
                  resourceId: target.id,
                  resourceVersionId: target.versionId ?? null,
                  kind: 'circle',
                  geometry: {
                    x: Math.max(0, Math.min(1 - width, centerX - width / 2)),
                    y: Math.max(0, Math.min(1 - height, centerY - height / 2)),
                    width,
                    height,
                  },
                });
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={target.previewUrl}
                alt={target.title}
                onLoad={(event) => {
                  const image = event.currentTarget;
                  if (image.naturalWidth && image.naturalHeight) {
                    setPreviewAspectRatio(
                      image.naturalWidth / image.naturalHeight,
                    );
                  }
                }}
              />
              <svg
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                {annotations
                  .filter((annotation) => annotation.resourceId === target.id)
                  .map((annotation) => (
                    <ellipse
                      key={annotation.clientId}
                      cx={
                        (annotation.geometry.x +
                          (annotation.geometry.width ?? 0.18) / 2) *
                        100
                      }
                      cy={
                        (annotation.geometry.y +
                          (annotation.geometry.height ?? 0.13) / 2) *
                        100
                      }
                      rx={((annotation.geometry.width ?? 0.18) / 2) * 100}
                      ry={((annotation.geometry.height ?? 0.13) / 2) * 100}
                    />
                  ))}
              </svg>
            </button>
          </div>
        ) : state.status === 'loading' ? (
          <CanvasShellStatus
            status="loading"
            title="正在打开"
            description="正在准备安全预览…"
          />
        ) : state.status === 'failed' ? (
          <CanvasShellStatus
            status={
              state.error.kind === 'empty' ? 'unavailable' : state.error.kind
            }
            title={
              state.error.kind === 'forbidden'
                ? '无权访问'
                : state.error.kind === 'not_found'
                  ? '资源不存在'
                  : '暂时无法打开'
            }
            description={state.error.message}
            onRetry={
              isRetryableResourceError(state.error.kind)
                ? () => {
                    setState({ status: 'loading' });
                    setReloadSequence((value) => value + 1);
                  }
                : undefined
            }
            retryLabel="重试"
          />
        ) : state.status === 'source' && SourceRenderer ? (
          <SourceRenderer resource={state.resource} />
        ) : state.status === 'source' ? (
          <CanvasShellStatus
            status="unavailable"
            title="暂不支持预览"
            description="这个资源没有兼容的安全渲染器。"
          />
        ) : (
          <ArtifactCanvasContent
            contentView={resolveArtifactContentView(state.detail, false)}
            detail={state.detail}
            revising={false}
            readOnly
            presentation="live-preview"
            onSaveNote={() => undefined}
          />
        )}
      </div>
    </section>
  );
}
