import { afterEach, describe, expect, it, vi } from 'vitest';
import { createArtifact, fetchNotebookArtifacts } from './artifact-client';

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

describe('artifact browser client', () => {
  it('validates artifact lists before returning summaries', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          artifacts: [
            {
              id: 'artifact-1',
              kind: 'mind_map',
              trustTier: 'tier1',
              title: '要点',
              status: 'active',
              latestVersion: 1,
            },
          ],
        }),
      ),
    );

    await expect(fetchNotebookArtifacts()).resolves.toEqual([
      {
        id: 'artifact-1',
        kind: 'mind_map',
        trustTier: 'tier1',
        title: '要点',
        status: 'active',
        latestVersion: 1,
      },
    ]);
  });

  it('rejects malformed create responses at the API client boundary', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          artifact: {
            id: 'artifact-1',
            kind: 'mind_map',
            trustTier: 'tier1',
            title: '要点',
            status: 'active',
            latestVersion: 1,
          },
        }),
      ),
    );

    await expect(createArtifact('mind_map', '要点')).rejects.toThrow(
      '产物创建响应格式不正确。',
    );
  });
});
