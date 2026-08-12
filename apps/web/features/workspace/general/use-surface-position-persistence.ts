'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { WorkspaceSurface } from './workspace-surface';
import {
  fetchSurfacePositions,
  saveSurfacePosition,
  SurfacePositionClientError,
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

export function restoreSurfacePositions(loaded: readonly SurfacePosition[]): {
  readonly positions: readonly SurfacePosition[];
  readonly active: SurfacePosition | null;
} {
  const active =
    loaded.find((position) => position.restState === 'open') ??
    loaded.find((position) => position.restState === 'pinned') ??
    null;
  if (!active) return { positions: loaded, active: null };
  return {
    active,
    positions: loaded.map((position) =>
      position !== active && position.restState === 'open'
        ? {
            ...position,
            zone: 'periphery' as const,
            restState: 'folded' as const,
          }
        : position,
    ),
  };
}

function clientError(
  error: unknown,
  fallback: 'surface_layout_load_failed' | 'surface_layout_save_failed',
): SurfacePositionClientError {
  return error instanceof SurfacePositionClientError
    ? error
    : new SurfacePositionClientError(fallback);
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
  const positions = useMemo(
    () =>
      positionState.notebookId === notebookId ? positionState.positions : [],
    [notebookId, positionState],
  );
  const positionsRef = useRef<readonly SurfacePosition[]>(positions);
  const [error, setError] = useState<SurfacePositionClientError | null>(null);
  const previousTargetRef = useRef<SurfaceTarget | null>(null);

  useEffect(() => {
    positionsRef.current = positions;
  }, [positions]);

  const persist = useCallback(
    (position: SaveSurfacePosition) => {
      void saveSurfacePosition(position)
        .then((saved) => {
          setError(null);
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
        .catch((reason: unknown) => {
          setError(clientError(reason, 'surface_layout_save_failed'));
        });
    },
    [notebookId],
  );

  useEffect(() => {
    const controller = new AbortController();
    previousTargetRef.current = null;
    void fetchSurfacePositions(controller.signal)
      .then((loaded) => {
        if (controller.signal.aborted) return;
        const restored = restoreSurfacePositions(loaded);
        setError(null);
        setPositionState({ notebookId, positions: restored.positions });
        const active = restored.active;
        if (!active) return;
        if (active.resourceKind === 'source') openSource(active.resourceId);
        else openArtifact(active.resourceId);
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setError(clientError(reason, 'surface_layout_load_failed'));
      });
    return () => controller.abort();
  }, [notebookId, openArtifact, openSource]);

  useEffect(() => {
    const current = getSurfacePositionTarget(surface);
    const previous = previousTargetRef.current;
    previousTargetRef.current = current;
    const timer = window.setTimeout(() => {
      const remembered = (target: SurfaceTarget) =>
        positionsRef.current.find(
          (position) =>
            position.resourceKind === target.resourceKind &&
            position.resourceId === target.resourceId,
        );
      if (
        previous &&
        (!current ||
          previous.resourceKind !== current.resourceKind ||
          previous.resourceId !== current.resourceId)
      ) {
        const previousPosition = remembered(previous);
        persist({
          ...previous,
          zone:
            previousPosition?.restState === 'pinned'
              ? previousPosition.zone
              : 'periphery',
          x:
            previousPosition?.restState === 'pinned'
              ? previousPosition.x
              : 0.88,
          y:
            previousPosition?.restState === 'pinned'
              ? previousPosition.y
              : 0.18,
          z: previousPosition?.restState === 'pinned' ? previousPosition.z : 0,
          restState:
            previousPosition?.restState === 'pinned' ? 'pinned' : 'folded',
        });
      }
      if (current) {
        const currentPosition = remembered(current);
        const pinned = currentPosition?.restState === 'pinned';
        persist({
          ...current,
          zone: pinned ? currentPosition.zone : 'center',
          x: pinned ? currentPosition.x : 0.5,
          y: pinned ? currentPosition.y : 0.5,
          z: pinned ? currentPosition.z : 10,
          restState: pinned ? 'pinned' : 'open',
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

  return { positions, openRestingSurface, error } as const;
}
