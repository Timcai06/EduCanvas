import { describe, expect, it } from 'vitest';
import { generalTurnArtifactIdempotency } from './operation-artifact-idempotency';

describe('general Turn Artifact idempotency', () => {
  it('为文档与图片工具生成同一 Turn 级键和数据库可接受的 SHA-256', () => {
    const identity = generalTurnArtifactIdempotency('operation-1');

    expect(identity.idempotencyKey).toBe('general-turn-artifact:operation-1');
    expect(identity.requestFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(generalTurnArtifactIdempotency('operation-1')).toEqual(identity);
    expect(generalTurnArtifactIdempotency('operation-2')).not.toEqual(identity);
  });
});
