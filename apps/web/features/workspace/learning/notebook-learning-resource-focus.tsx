'use client';

import { useEffect, useState, type ComponentType, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import type { CanvasResource } from '@educanvas/canvas-protocol';
import type { CanvasResourceRendererProps } from '@/features/canvas/canvas-resource-registry';
import { fetchCanvasResource } from '@/features/canvas/canvas-resource-client';
import { selectWebCanvasResourceRenderer } from '@/features/canvas/web-canvas-resource-registry';
import {
  fetchArtifactDetail,
  type ArtifactDetail,
} from '@/features/canvas/artifact-client';
import { ArtifactCanvasContent } from '@/features/canvas/artifact-canvas-content';
import { resolveArtifactContentView } from '@/features/canvas/artifact-content-view';
import { CanvasHost } from '@/features/canvas/canvas-host';
import { SourceResourceRenderer } from '@/features/assets/source-resource-renderer';
import { NotebookRequestScopeProvider } from '../general/notebook-request-scope';
import type { NotebookRequestContext } from '../general/notebook-request-context';
import type { HomeFocusTarget } from '../general/home-focus';

type FocusResource =
  | {
      kind: 'source';
      resource: CanvasResource;
      Renderer: ComponentType<CanvasResourceRendererProps>;
    }
  | { kind: 'artifact'; detail: ArtifactDetail };

/** DP08课程交接沿用同本权限和受信Renderer；GET只查看资源，不修改教学状态。 */
export function NotebookLearningResourceFocus({
  target,
  requestContext,
  children,
}: {
  target: HomeFocusTarget | null;
  requestContext: NotebookRequestContext | null;
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(Boolean(target));
  const [resource, setResource] = useState<FocusResource | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const notebookId = requestContext?.notebookId;
  const conversationId = requestContext?.conversationId;
  const resourceId = target?.resourceId;
  const kind = target?.kind;
  useEffect(() => {
    if (!open || !resourceId || !kind) return;
    const controller = new AbortController();
    const context =
      notebookId && conversationId ? { notebookId, conversationId } : null;
    async function load() {
      if (!context) throw new Error('unavailable');
      const metadata = await fetchCanvasResource(kind!, resourceId!, {
        signal: controller.signal,
        requestContext: context,
      });
      if (!metadata.allowedActions.includes('view'))
        throw new Error('unavailable');
      if (kind === 'artifact') {
        const detail = await fetchArtifactDetail(resourceId!, undefined, {
          signal: controller.signal,
          requestContext: context,
        });
        if (!controller.signal.aborted) {
          setResource({ kind: 'artifact', detail });
          setError(null);
        }
        return;
      }
      const selection = selectWebCanvasResourceRenderer(metadata);
      if (selection.kind !== 'available') throw new Error('unavailable');
      if (!controller.signal.aborted) {
        setResource({
          kind: 'source',
          resource: metadata,
          Renderer: selection.Renderer,
        });
        setError(null);
      }
    }
    void load().catch(() => {
      if (!controller.signal.aborted)
        setError('指定资源暂时无法打开。请重试或返回笔记本计划。');
    });
    return () => controller.abort();
  }, [open, resourceId, kind, notebookId, conversationId, retry]);
  const close = () => {
    setOpen(false);
    router.replace(pathname);
  };
  return (
    <NotebookRequestScopeProvider value={requestContext}>
      {children}
      {open ? (
        resource?.kind === 'source' ? (
          <SourceResourceRenderer
            resource={resource.resource}
            Renderer={resource.Renderer}
            isFull
            onToggleFull={() => undefined}
            canExitFullscreen={false}
            onClose={close}
          />
        ) : (
          <CanvasHost
            ariaLabel={
              resource?.kind === 'artifact' ? '交接产物预览' : '交接资源预览'
            }
            title={
              resource?.kind === 'artifact'
                ? resource.detail.artifact.title
                : '打开交接资源'
            }
            closeLabel="返回学习"
            isFull
            onClose={close}
          >
            {resource?.kind === 'artifact' ? (
              <ArtifactCanvasContent
                contentView={resolveArtifactContentView(resource.detail, false)}
                detail={resource.detail}
                revising={false}
                readOnly
                onSaveNote={() => undefined}
              />
            ) : (
              <div className="p-6" role={error ? 'alert' : 'status'}>
                <p>{error ?? '正在读取指定资源…'}</p>
                {error ? (
                  <button
                    className="mt-4 min-h-11 rounded-xl border border-line px-4 text-sm focus-visible:ring-2 focus-visible:ring-accent"
                    onClick={() => {
                      setError(null);
                      setRetry((value) => value + 1);
                    }}
                  >
                    重试
                  </button>
                ) : null}
              </div>
            )}
          </CanvasHost>
        )
      ) : null}
    </NotebookRequestScopeProvider>
  );
}
