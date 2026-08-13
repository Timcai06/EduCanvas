import { describe, expect, it } from 'vitest';
import type { ArtifactDetail } from './artifact-client';
import { projectRevisionPollResult } from './artifact-generation-flow';

function detailWithVersion(latestVersion: number): ArtifactDetail {
  return {
    artifact: {
      id: 'artifact-1',
      kind: 'mind_map',
      trustTier: 'tier1',
      title: '已有思维导图',
      status: 'active',
      latestVersion,
      fromConversation: true,
      createdAt: '2026-08-13T00:00:00.000Z',
      updatedAt: '2026-08-13T00:00:00.000Z',
    },
    version: {
      id: '00000000-0000-4000-8000-000000000001',
      version: latestVersion,
      content: { root: '已有内容' },
      media: null,
    },
    versions: [],
    latestJob: {
      id: '00000000-0000-4000-8000-000000000002',
      status: 'running',
      progress: 10,
      failureCode: null,
    },
  };
}

describe('Artifact revision outcome', () => {
  it.each(['failed', 'cancelled'] as const)(
    '已有版本时 revision %s 不覆盖对象级可用状态，并单独暴露 outcome',
    (revisionOutcome) => {
      const detail = detailWithVersion(1);
      const state = projectRevisionPollResult(
        'mind_map',
        'artifact-1',
        'fallback',
        { detail, outcome: revisionOutcome },
      );

      expect(state).toMatchObject({
        phase: 'ready',
        outcome: 'ready',
        revisionOutcome,
        artifactId: 'artifact-1',
        detail,
      });
    },
  );

  it('revision timed_out 仍可打开已有版本，且不丢失 recoverable outcome', () => {
    const detail = detailWithVersion(2);
    const state = projectRevisionPollResult(
      'mind_map',
      'artifact-1',
      'fallback',
      { detail, outcome: 'timed_out' },
    );

    expect(state.phase).toBe('ready');
    expect(state.outcome).toBe('ready');
    expect(state.revisionOutcome).toBe('timed_out');
    expect(state.detail).toBe(detail);
  });

  it('ready revision 不会携带 revisionOutcome，避免重复成功状态卡', () => {
    const detail = detailWithVersion(2);
    const state = projectRevisionPollResult(
      'mind_map',
      'artifact-1',
      'fallback',
      { detail, outcome: 'ready' },
    );

    expect(state).toMatchObject({
      phase: 'ready',
      outcome: 'ready',
      revisionOutcome: undefined,
      artifactId: 'artifact-1',
      detail,
    });
  });
});
