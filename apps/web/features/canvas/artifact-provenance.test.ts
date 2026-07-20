import { describe, expect, it } from 'vitest';
import type { ArtifactDetail } from './artifact-client';
import { isArtifactGenerating } from './artifact-provenance-model';

function detail(
  latestJob: ArtifactDetail['latestJob'],
): ArtifactDetail {
  return {
    artifact: {
      id: 'a',
      kind: 'mind_map',
      trustTier: 'tier1',
      title: 't',
      status: 'active',
      latestVersion: 1,
      fromConversation: true,
      createdAt: '2026-07-20T06:00:00.000Z',
      updatedAt: '2026-07-20T06:00:00.000Z',
    },
    version: { version: 1, content: {}, media: null },
    versions: [],
    latestJob,
  };
}

describe('isArtifactGenerating', () => {
  it('is true while a job is queued or running', () => {
    expect(
      isArtifactGenerating(
        detail({ id: 'j', status: 'queued', progress: null, failureCode: null }),
        false,
      ),
    ).toBe(true);
    expect(
      isArtifactGenerating(
        detail({ id: 'j', status: 'running', progress: 40, failureCode: null }),
        false,
      ),
    ).toBe(true);
  });

  it('is true while a revision is in flight regardless of last job', () => {
    expect(isArtifactGenerating(detail(null), true)).toBe(true);
  });

  it('is false when settled (succeeded/failed) and not revising', () => {
    expect(
      isArtifactGenerating(
        detail({
          id: 'j',
          status: 'succeeded',
          progress: 100,
          failureCode: null,
        }),
        false,
      ),
    ).toBe(false);
    expect(
      isArtifactGenerating(
        detail({
          id: 'j',
          status: 'failed',
          progress: null,
          failureCode: 'runtime_failed',
        }),
        false,
      ),
    ).toBe(false);
  });
});
