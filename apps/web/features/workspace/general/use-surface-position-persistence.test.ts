import { describe, expect, it } from 'vitest';
import { getSurfacePositionTarget } from './use-surface-position-persistence';

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
