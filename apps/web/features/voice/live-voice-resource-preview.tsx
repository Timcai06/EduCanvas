'use client';

import { ArrowLeft, X } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
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

export type LiveVoicePreviewTarget =
  | { readonly kind: 'source'; readonly id: string; readonly title: string }
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
  onClose,
}: {
  readonly target: LiveVoicePreviewTarget;
  readonly scopeKey: string;
  readonly onClose: () => void;
}) {
  const [reloadSequence, setReloadSequence] = useState(0);
  const [state, setState] = useState<PreviewState>({ status: 'loading' });

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
        <button type="button" onClick={onClose} aria-label="关闭预览">
          <X size={18} />
        </button>
      </header>
      <div className="live-voice-resource-preview__body">
        {state.status === 'loading' ? (
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
