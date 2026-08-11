'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { WorkspaceSurface } from './workspace-surface';
import {
  fetchSurfacePositions,
  saveSurfacePosition,
  type SaveSurfacePosition,
  type SurfacePosition,
} from './surface-position-client';

interface SurfaceTarget {
  readonly resourceKind: 'source' | 'artifact';
  readonly resourceId: string;
}

export function getSurfacePositionTarget(
  surface: WorkspaceSurface,
): SurfaceTarget | null {
  if (surface.type === 'source') {
    return { resourceKind: 'source', resourceId: surface.resourceId };
  }
  if (surface.type === 'artifact') {
    return { resourceKind: 'artifact', resourceId: surface.artifactId };
  }
  return null;
}

/**
 * 将工作面的空间记忆隔离在主控制器之外。
 *
 * 持久化是体验增强而非业务事实：网络失败不会阻断资源打开；Notebook 切换时
 * 会中止旧请求并清空旧案面，避免把上一个空间的私人注意力布局带进新空间。
 */
export function useSurfacePositionPersistence(options: {
  readonly notebookId: string;
  readonly surface: WorkspaceSurface;
  readonly openSource: (resourceId: string) => void;
  readonly openArtifact: (resourceId: string) => void;
}) {
  const { notebookId, surface, openSource, openArtifact } = options;
  const [positionState, setPositionState] = useState<{
    readonly notebookId: string;
    readonly positions: readonly SurfacePosition[];
  }>({ notebookId, positions: [] });
  const positions =
    positionState.notebookId === notebookId ? positionState.positions : [];
  const previousTargetRef = useRef<SurfaceTarget | null>(null);

  const persist = useCallback(
    (position: SaveSurfacePosition) => {
      void saveSurfacePosition(position)
        .then((saved) => {
          setPositionState((current) =>
            current.notebookId !== notebookId
              ? current
              : {
                  notebookId,
                  positions: [
                    saved,
                    ...current.positions.filter(
                      (item) =>
                        item.resourceKind !== saved.resourceKind ||
                        item.resourceId !== saved.resourceId,
                    ),
                  ],
                },
          );
        })
        .catch(() => undefined);
    },
    [notebookId],
  );

  useEffect(() => {
    const controller = new AbortController();
    previousTargetRef.current = null;
    void fetchSurfacePositions(controller.signal)
      .then((loaded) => {
        if (controller.signal.aborted) return;
        setPositionState({ notebookId, positions: loaded });
        const active = loaded.find(
          (position) =>
            position.restState === 'open' || position.restState === 'pinned',
        );
        if (!active) return;
        if (active.resourceKind === 'source') openSource(active.resourceId);
        else openArtifact(active.resourceId);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [notebookId, openArtifact, openSource]);

  useEffect(() => {
    const current = getSurfacePositionTarget(surface);
    const previous = previousTargetRef.current;
    previousTargetRef.current = current;
    const timer = window.setTimeout(() => {
      if (
        previous &&
        (!current ||
          previous.resourceKind !== current.resourceKind ||
          previous.resourceId !== current.resourceId)
      ) {
        persist({
          ...previous,
          zone: 'periphery',
          x: 0.88,
          y: 0.18,
          z: 0,
          restState: 'folded',
        });
      }
      if (current) {
        persist({
          ...current,
          zone: 'center',
          x: 0.5,
          y: 0.5,
          z: 10,
          restState: 'open',
        });
      }
    }, 320);
    return () => window.clearTimeout(timer);
  }, [persist, surface]);

  const openRestingSurface = useCallback(
    (position: SurfacePosition) => {
      if (position.resourceKind === 'source') openSource(position.resourceId);
      else openArtifact(position.resourceId);
    },
    [openArtifact, openSource],
  );

  return { positions, openRestingSurface } as const;
}
