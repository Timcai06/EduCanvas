import { describe, expect, it } from 'vitest';
import { resolveArtifactGenerationIntent } from './artifact-generation-intent';

describe('resolveArtifactGenerationIntent', () => {
  it('区分兼容生成、Agent 本轮要求与 Canvas 修订', () => {
    expect(resolveArtifactGenerationIntent({})).toEqual({
      kind: 'conversation',
    });
    expect(
      resolveArtifactGenerationIntent({
        generation: { instruction: '只梳理勾股定理的证明和常见误区' },
        provenance: {
          sources: [
            {
              assetId: 'eed27017-ab17-4345-8ed2-15098f7a3c08',
              versionId: 'ae1d43ac-ad01-43b9-9c76-b3d9af7774fa',
              representation: {
                kind: 'text',
                quality: 'structured',
                variant: 'default',
                producer: 'mineru',
                producerVersion: 'v1',
              },
            },
          ],
        },
      }),
    ).toEqual({
      kind: 'initial',
      instruction: '只梳理勾股定理的证明和常见误区',
    });
    expect(
      resolveArtifactGenerationIntent({
        generation: { instruction: '生成本轮总结' },
        provenance: { sources: [] },
      }),
    ).toEqual({
      kind: 'initial',
      instruction: '生成本轮总结',
    });
    expect(
      resolveArtifactGenerationIntent({
        generation: { instruction: '解释图片内容' },
        provenance: {
          sources: [
            {
              assetId: 'eed27017-ab17-4345-8ed2-15098f7a3c08',
              versionId: 'ae1d43ac-ad01-43b9-9c76-b3d9af7774fa',
              representation: null,
            },
          ],
        },
      }),
    ).toEqual({
      kind: 'initial',
      instruction: '解释图片内容',
    });
    expect(
      resolveArtifactGenerationIntent({
        revision: { baseVersion: 2, instruction: '增加一道例题' },
      }),
    ).toEqual({
      kind: 'revision',
      baseVersion: 2,
      instruction: '增加一道例题',
    });
  });

  it('拒绝混合、未知和超长参数', () => {
    for (const params of [
      { generation: { instruction: 'x' }, unknown: true },
      {
        generation: { instruction: 'x' },
        revision: { baseVersion: 1, instruction: 'y' },
      },
      { generation: { instruction: 'x'.repeat(2_001) } },
      {
        generation: { instruction: 'x' },
        provenance: {
          sources: [
            {
              assetId: 'not-a-uuid',
              versionId: 'ae1d43ac-ad01-43b9-9c76-b3d9af7774fa',
              representation: null,
            },
          ],
        },
      },
      {
        generation: { instruction: 'x' },
        provenance: { sources: [], providerBody: 'must-not-pass' },
      },
    ]) {
      expect(resolveArtifactGenerationIntent(params)).toEqual({
        kind: 'invalid',
      });
    }
  });
});
