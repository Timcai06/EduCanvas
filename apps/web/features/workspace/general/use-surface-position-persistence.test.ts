import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createSurfacePositionPersistenceScheduler,
  createSurfacePositionWriteQueue,
  getSurfacePositionTarget,
  restoreSurfacePositions,
} from './use-surface-position-persistence';
import type {
  SaveSurfacePosition,
  SurfacePosition,
} from './surface-position-client';
import type { NotebookRequestContext } from './notebook-request-context';

afterEach(() => vi.useRealTimers());

describe('getSurfacePositionTarget', () => {
  it('只为可摆放的资料与作品生成位置身份', () => {
    expect(
      getSurfacePositionTarget({
        type: 'source',
        resourceId: 'source-id',
        full: false,
      }),
    ).toEqual({ resourceKind: 'source', resourceId: 'source-id' });
    expect(
      getSurfacePositionTarget({
        type: 'artifact',
        artifactId: 'artifact-id',
        full: false,
      }),
    ).toEqual({ resourceKind: 'artifact', resourceId: 'artifact-id' });
    expect(getSurfacePositionTarget({ type: 'none' })).toBeNull();
    expect(getSurfacePositionTarget({ type: 'studio' })).toBeNull();
  });
});

function position(
  resourceId: string,
  restState: SurfacePosition['restState'],
  updatedAt: string,
): SurfacePosition {
  return {
    resourceKind: 'source',
    resourceId,
    zone: restState === 'open' ? 'center' : 'periphery',
    x: 0.5,
    y: 0.5,
    z: restState === 'open' ? 10 : 0,
    restState,
    updatedAt,
  };
}

function context(notebookId: string): NotebookRequestContext {
  return { notebookId, conversationId: `${notebookId}-conversation` };
}

function saveInput(resourceId: string, restState: 'open' | 'folded') {
  return {
    resourceKind: 'artifact' as const,
    resourceId,
    zone: restState === 'open' ? ('center' as const) : ('periphery' as const),
    x: restState === 'open' ? 0.5 : 0.88,
    y: restState === 'open' ? 0.5 : 0.18,
    z: restState === 'open' ? 10 : 0,
    restState,
  };
}

describe('surface position persistence scheduling', () => {
  it('closes immediately, cancels the pending open, and keeps the old notebook scope', () => {
    vi.useFakeTimers();
    const saves: Array<{
      context: NotebookRequestContext;
      position: SaveSurfacePosition;
    }> = [];
    const scheduler = createSurfacePositionPersistenceScheduler(
      (scope, value) => saves.push({ context: scope, position: value }),
    );
    const oldScope = context('notebook-old');

    scheduler.update(
      oldScope,
      { type: 'artifact', artifactId: 'artifact-id', full: false },
      [],
    );
    vi.advanceTimersByTime(300);
    scheduler.update(oldScope, { type: 'none' }, []);
    scheduler.update(context('notebook-new'), { type: 'none' }, []);
    vi.advanceTimersByTime(400);

    expect(saves).toEqual([
      {
        context: oldScope,
        position: saveInput('artifact-id', 'folded'),
      },
    ]);
    scheduler.dispose();
  });

  it('closing a pinned surface preserves its saved placement', () => {
    const saves: SaveSurfacePosition[] = [];
    const scheduler = createSurfacePositionPersistenceScheduler(
      (_scope, value) => saves.push(value),
    );
    const scope = context('notebook-pinned');
    const pinned: SurfacePosition = {
      resourceKind: 'artifact',
      resourceId: 'artifact-pinned',
      zone: 'margin',
      x: 0.22,
      y: 0.74,
      z: 4,
      restState: 'pinned',
      updatedAt: '2026-10-02T00:00:00.000Z',
    };

    scheduler.update(
      scope,
      { type: 'artifact', artifactId: pinned.resourceId, full: false },
      [pinned],
    );
    scheduler.update(scope, { type: 'none' }, [pinned]);

    expect(saves).toEqual([
      {
        resourceKind: pinned.resourceKind,
        resourceId: pinned.resourceId,
        zone: pinned.zone,
        x: pinned.x,
        y: pinned.y,
        z: pinned.z,
        restState: 'pinned',
      },
    ]);
    scheduler.dispose();
  });

  it('orders in-flight open before close and blocks return GET until the close is saved', async () => {
    const oldScope = context('notebook-old');
    const otherScope = context('notebook-other');
    const writes: Array<{ scope: NotebookRequestContext; restState: string }> =
      [];
    let finishOpen!: (value: SurfacePosition) => void;
    const queue = createSurfacePositionWriteQueue((scope, value) => {
      writes.push({ scope, restState: value.restState });
      if (
        scope.notebookId === oldScope.notebookId &&
        value.restState === 'open'
      ) {
        return new Promise<SurfacePosition>((resolve) => {
          finishOpen = resolve;
        });
      }
      return Promise.resolve({
        ...value,
        updatedAt: '2026-10-02T00:00:00.000Z',
      });
    });

    const openWrite = queue.enqueue(oldScope, saveInput('artifact-id', 'open'));
    await Promise.resolve();
    const closeWrite = queue.enqueue(
      oldScope,
      saveInput('artifact-id', 'folded'),
    );
    let returnedGetReady = false;
    const returnGet = queue
      .waitForNotebook(oldScope.notebookId)
      .then(() => (returnedGetReady = true));
    const isolatedWrite = queue.enqueue(
      otherScope,
      saveInput('other-artifact-id', 'open'),
    );

    await Promise.resolve();
    expect(writes).toContainEqual({
      scope: otherScope,
      restState: 'open',
    });
    expect(writes.filter((write) => write.scope === oldScope)).toEqual([
      { scope: oldScope, restState: 'open' },
    ]);
    expect(returnedGetReady).toBe(false);

    finishOpen({
      ...saveInput('artifact-id', 'open'),
      updatedAt: '2026-10-02T00:00:00.000Z',
    });
    await Promise.all([openWrite, closeWrite, isolatedWrite, returnGet]);

    expect(writes.filter((write) => write.scope === oldScope)).toEqual([
      { scope: oldScope, restState: 'open' },
      { scope: oldScope, restState: 'folded' },
    ]);
    expect(returnedGetReady).toBe(true);
  });
});

describe('restoreSurfacePositions', () => {
  it('只恢复最近的 open，并让其余陈旧 open 重新可见', () => {
    const newest = position(
      '00000000-0000-4000-8000-000000000001',
      'open',
      '2026-08-13T01:00:00.000Z',
    );
    const stale = position(
      '00000000-0000-4000-8000-000000000002',
      'open',
      '2026-08-13T00:00:00.000Z',
    );
    const restored = restoreSurfacePositions([newest, stale]);

    expect(restored.active).toBe(newest);
    expect(restored.positions).toEqual([
      newest,
      expect.objectContaining({
        resourceId: stale.resourceId,
        zone: 'periphery',
        restState: 'folded',
      }),
    ]);
  });

  it('没有 open 时恢复一个 pinned，但保留所有 pinned 可见状态', () => {
    const first = position(
      '00000000-0000-4000-8000-000000000003',
      'pinned',
      '2026-08-13T01:00:00.000Z',
    );
    const second = position(
      '00000000-0000-4000-8000-000000000004',
      'pinned',
      '2026-08-13T00:00:00.000Z',
    );
    const restored = restoreSurfacePositions([first, second]);

    expect(restored.active).toBe(first);
    expect(restored.positions).toEqual([first, second]);
  });

  it('没有 active 状态时不臆造资源打开', () => {
    const folded = position(
      '00000000-0000-4000-8000-000000000005',
      'folded',
      '2026-08-13T00:00:00.000Z',
    );
    expect(restoreSurfacePositions([folded])).toEqual({
      positions: [folded],
      active: null,
    });
  });
});
