import { describe, expect, it } from 'vitest';
import {
  getSurfacePositionTarget,
  restoreSurfacePositions,
} from './use-surface-position-persistence';
import type { SurfacePosition } from './surface-position-client';

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
