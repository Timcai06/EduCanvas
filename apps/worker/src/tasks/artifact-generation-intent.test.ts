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
      }),
    ).toEqual({
      kind: 'initial',
      instruction: '只梳理勾股定理的证明和常见误区',
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
    ]) {
      expect(resolveArtifactGenerationIntent(params)).toEqual({
        kind: 'invalid',
      });
    }
  });
});
