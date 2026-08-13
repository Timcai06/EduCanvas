import { describe, expect, it } from 'vitest';
import { generalTurnArtifactIdempotency } from './operation-artifact-idempotency';

describe('general Turn Artifact idempotency', () => {
  const request = {
    kind: 'mind_map',
    title: '分数思维导图',
    instruction: '整理课程内容。',
    provenance: {
      sources: [
        {
          assetId: 'asset-1',
          versionId: 'version-1',
          representation: null,
        },
      ],
    },
  } as const;

  it('为文档与图片工具生成同一 Turn 级键和数据库可接受的 SHA-256', () => {
    const identity = generalTurnArtifactIdempotency('operation-1', request);

    expect(identity.idempotencyKey).toBe('general-turn-artifact:operation-1');
    expect(identity.requestFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(generalTurnArtifactIdempotency('operation-1', request)).toEqual(
      identity,
    );
    expect(generalTurnArtifactIdempotency('operation-2', request)).not.toEqual(
      identity,
    );
  });

  it('将语义字段和 provenance 绑定到指纹，而保留 Turn 级幂等键', () => {
    const identity = generalTurnArtifactIdempotency('operation-1', request);

    for (const changed of [
      { ...request, title: '另一张图' },
      { ...request, instruction: '改写课程内容。' },
      {
        ...request,
        provenance: {
          sources: [
            {
              assetId: 'asset-2',
              versionId: 'version-2',
              representation: null,
            },
          ],
        },
      },
    ]) {
      const changedIdentity = generalTurnArtifactIdempotency(
        'operation-1',
        changed,
      );
      expect(changedIdentity.idempotencyKey).toBe(identity.idempotencyKey);
      expect(changedIdentity.requestFingerprint).not.toBe(
        identity.requestFingerprint,
      );
    }
  });

  it('按数组首见顺序保留 provenance 语义，且对象键顺序不影响指纹', () => {
    const reorderedKeys = {
      provenance: request.provenance,
      instruction: request.instruction,
      title: request.title,
      kind: request.kind,
    };
    expect(
      generalTurnArtifactIdempotency('operation-1', reorderedKeys),
    ).toEqual(generalTurnArtifactIdempotency('operation-1', request));
    expect(
      generalTurnArtifactIdempotency('operation-1', {
        ...request,
        provenance: {
          sources: [
            {
              assetId: 'asset-0',
              versionId: 'version-0',
              representation: null,
            },
            ...request.provenance.sources,
          ],
        },
      }),
    ).not.toEqual(generalTurnArtifactIdempotency('operation-1', request));
  });
});
