'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { WorkspaceSurface } from './workspace-surface';
import type { NotebookRequestContext } from './notebook-request-context';
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

type SurfacePositionWriter = (
  context: NotebookRequestContext,
  position: SaveSurfacePosition,
) => Promise<SurfacePosition>;

/** A notebook's writes are serialized so an older open cannot land after its close. */
export function createSurfacePositionWriteQueue(writer: SurfacePositionWriter) {
  const tails = new Map<string, Promise<void>>();

  return {
    enqueue(
      context: NotebookRequestContext,
      position: SaveSurfacePosition,
    ): Promise<SurfacePosition> {
      const previous = tails.get(context.notebookId) ?? Promise.resolve();
      const operation = previous.then(() => writer(context, position));
      const settled = operation.then(
        () => undefined,
        () => undefined,
      );
      tails.set(context.notebookId, settled);
      void settled.then(() => {
        if (tails.get(context.notebookId) === settled) {
          tails.delete(context.notebookId);
        }
      });
      return operation;
    },
    async waitForNotebook(notebookId: string): Promise<void> {
      await tails.get(notebookId);
    },
  };
}

interface TrackedSurface {
  readonly context: NotebookRequestContext;
  readonly target: SurfaceTarget;
  readonly positions: readonly SurfacePosition[];
}

function sameTarget(left: TrackedSurface, right: TrackedSurface): boolean {
  return (
    left.context.notebookId === right.context.notebookId &&
    left.target.resourceKind === right.target.resourceKind &&
    left.target.resourceId === right.target.resourceId
  );
}

function rememberedPosition(
  tracked: TrackedSurface,
): SurfacePosition | undefined {
  return tracked.positions.find(
    (position) =>
      position.resourceKind === tracked.target.resourceKind &&
      position.resourceId === tracked.target.resourceId,
  );
}

function restingPosition(
  tracked: TrackedSurface,
  restState: 'open' | 'folded',
): SaveSurfacePosition {
  const remembered = rememberedPosition(tracked);
  const pinned = remembered?.restState === 'pinned';
  return {
    ...tracked.target,
    zone: pinned
      ? remembered.zone
      : restState === 'open'
        ? 'center'
        : 'periphery',
    x: pinned ? remembered.x : restState === 'open' ? 0.5 : 0.88,
    y: pinned ? remembered.y : restState === 'open' ? 0.5 : 0.18,
    z: pinned ? remembered.z : restState === 'open' ? 10 : 0,
    restState: pinned ? 'pinned' : restState,
  };
}

/**
 * Open persistence stays debounced; leaving an open surface writes its folded
 * state immediately so a fast route change cannot cancel the close intent.
 */
export function createSurfacePositionPersistenceScheduler(
  persist: (
    context: NotebookRequestContext,
    position: SaveSurfacePosition,
  ) => void,
  debounceMs = 320,
) {
  let active: TrackedSurface | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clearTimer = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  return {
    update(
      context: NotebookRequestContext,
      surface: WorkspaceSurface,
      positions: readonly SurfacePosition[],
    ) {
      const target = getSurfacePositionTarget(surface);
      const next = target ? { context, target, positions } : null;
      const unchanged = active && next && sameTarget(active, next);
      const previous =
        active && active.context.notebookId === context.notebookId
          ? { ...active, positions }
          : active;
      clearTimer();

      if (previous && !unchanged) {
        persist(previous.context, restingPosition(previous, 'folded'));
      }

      active = next;
      if (next) {
        const scheduled = next;
        timer = setTimeout(() => {
          timer = null;
          persist(scheduled.context, restingPosition(scheduled, 'open'));
        }, debounceMs);
      }
    },
    dispose() {
      clearTimer();
    },
  };
}

const surfacePositionWriteQueue = createSurfacePositionWriteQueue(
  (context, position) => saveSurfacePosition(position, context),
);

/**
 * 将工作面的空间记忆隔离在主控制器之外。
 *
 * 持久化是体验增强而非业务事实：网络失败不会阻断资源打开；Notebook 切换时
 * 会中止旧请求并清空旧案面，避免把上一个空间的私人注意力布局带进新空间。
 */
export function useSurfacePositionPersistence(options: {
  readonly notebookId: string;
  readonly conversationId: string;
  readonly surface: WorkspaceSurface;
  readonly openSource: (resourceId: string) => void;
  readonly openArtifact: (resourceId: string) => void;
}) {
  const { notebookId, conversationId, surface, openSource, openArtifact } =
    options;
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
  const latestNotebookIdRef = useRef(notebookId);

  useLayoutEffect(() => {
    latestNotebookIdRef.current = notebookId;
  }, [notebookId]);

  useEffect(() => {
    positionsRef.current = positions;
  }, [positions]);

  const persist = useCallback(
    (context: NotebookRequestContext, position: SaveSurfacePosition) => {
      void surfacePositionWriteQueue
        .enqueue(context, position)
        .then((saved) => {
          if (latestNotebookIdRef.current !== context.notebookId) return;
          setError(null);
          setPositionState((current) =>
            current.notebookId !== context.notebookId
              ? current
              : {
                  notebookId: context.notebookId,
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
          if (latestNotebookIdRef.current === context.notebookId) {
            setError(clientError(reason, 'surface_layout_save_failed'));
          }
        });
    },
    [],
  );

  const schedulerRef = useRef<ReturnType<
    typeof createSurfacePositionPersistenceScheduler
  > | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const context = { notebookId, conversationId };
    void surfacePositionWriteQueue
      .waitForNotebook(notebookId)
      .then(() => {
        if (controller.signal.aborted) return [];
        return fetchSurfacePositions(controller.signal, context);
      })
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
  }, [notebookId, conversationId, openArtifact, openSource]);

  useEffect(() => {
    let scheduler = schedulerRef.current;
    if (scheduler === null) {
      scheduler = createSurfacePositionPersistenceScheduler(persist);
      schedulerRef.current = scheduler;
    }
    scheduler.update(
      { notebookId, conversationId },
      surface,
      positionsRef.current,
    );
  }, [conversationId, notebookId, persist, surface]);

  useEffect(() => () => schedulerRef.current?.dispose(), []);

  const openRestingSurface = useCallback(
    (position: SurfacePosition) => {
      if (position.resourceKind === 'source') openSource(position.resourceId);
      else openArtifact(position.resourceId);
    },
    [openArtifact, openSource],
  );

  return { positions, openRestingSurface, error } as const;
}
