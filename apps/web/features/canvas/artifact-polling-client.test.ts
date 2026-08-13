import { afterEach, describe, expect, it, vi } from 'vitest';
import { pollArtifactUntilSettled } from './artifact-polling-client';

function detail(overrides: {
  status: 'running' | 'succeeded';
  progress: number;
  latestVersion?: number;
}) {
  return {
    artifact: {
      id: 'artifact-1',
      kind: 'mind_map',
      trustTier: 'tier1',
      title: '思维导图',
      status: 'proposed',
      latestVersion: overrides.latestVersion ?? 0,
      fromConversation: true,
      createdAt: '2026-08-13T00:00:00.000Z',
      updatedAt: '2026-08-13T00:00:00.000Z',
    },
    version: null,
    versions: [],
    latestJob: {
      id: '00000000-0000-4000-8000-000000000002',
      status: overrides.status,
      progress: overrides.progress,
      failureCode: null,
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('pollArtifactUntilSettled progress reporting', () => {
  it('每轮拉取后把服务端 job 进度回报给 onProgress，直到终态', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify(detail({ status: 'running', progress: 15 })),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify(detail({ status: 'running', progress: 85 })),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify(
            detail({ status: 'succeeded', progress: 100, latestVersion: 1 }),
          ),
          { status: 200 },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    const seen: number[] = [];
    const result = await pollArtifactUntilSettled('artifact-1', {
      intervalMs: 1,
      timeoutMs: 200,
      onProgress: (progress) => seen.push(progress),
    });

    expect(result.outcome).toBe('ready');
    expect(seen).toEqual([15, 85, 100]);
  });

  it('latestJob 缺进度（旧数据）时不回调，不抛异常', async () => {
    const withoutJob = {
      ...detail({ status: 'running', progress: 0 }),
      latestJob: null,
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(withoutJob), { status: 200 })),
    );

    const seen: number[] = [];
    await pollArtifactUntilSettled('artifact-1', {
      intervalMs: 1,
      timeoutMs: 10,
      onProgress: (progress) => seen.push(progress),
    });

    expect(seen).toEqual([]);
  });
});
