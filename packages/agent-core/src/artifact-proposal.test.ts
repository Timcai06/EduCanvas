import { describe, expect, it } from 'vitest';
import {
  artifactProposalKinds,
  artifactProposalSchema,
} from './artifact-proposal';

describe('artifact proposal contract', () => {
  it.each(artifactProposalKinds)('accepts closed kind %s', (kind) => {
    expect(
      artifactProposalSchema.parse({
        kind,
        title: '光合作用',
        instruction: '整理本轮要点并生成完整产物',
      }),
    ).toMatchObject({ kind });
  });

  it('rejects identity, storage, provider and arbitrary artifact kinds', () => {
    expect(
      artifactProposalSchema.safeParse({
        kind: 'root_shell',
        title: '越权',
        instruction: '执行',
      }).success,
    ).toBe(false);
    expect(
      artifactProposalSchema.safeParse({
        kind: 'mind_map',
        title: '越权',
        instruction: '执行',
        subjectId: 'forged',
        storageKey: 'secret',
        provider: 'raw',
      }).success,
    ).toBe(false);
  });
});
