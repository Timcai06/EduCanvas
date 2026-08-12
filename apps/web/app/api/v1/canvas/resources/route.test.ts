import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/server/identity/effective-subject', () => ({
  readEffectiveSubject: vi.fn(),
}));
vi.mock(
  '@/server/canvas/workspace-resource-read-model',
  async (importOriginal) => {
    const original =
      await importOriginal<
        typeof import('@/server/canvas/workspace-resource-read-model')
      >();
    return { ...original, listWorkspaceResourceSummaries: vi.fn() };
  },
);

import { readEffectiveSubject } from '@/server/identity/effective-subject';
import { listWorkspaceResourceSummaries } from '@/server/canvas/workspace-resource-read-model';
import { WorkspaceResourceReadModelError } from '@/server/canvas/workspace-resource-read-model';
import { GET } from './route';

describe('GET /api/v1/canvas/resources', () => {
  beforeEach(() => vi.clearAllMocks());

  it('fails closed without an effective data owner', async () => {
    vi.mocked(readEffectiveSubject).mockResolvedValue({
      dataOwnerId: null,
    } as never);
    const response = await GET(
      new Request('http://localhost/api/v1/canvas/resources'),
    );
    expect(response.status).toBe(401);
    expect(listWorkspaceResourceSummaries).not.toHaveBeenCalled();
  });

  it('resolves subject once and passes one owner to the batch read model', async () => {
    vi.mocked(readEffectiveSubject).mockResolvedValue({
      dataOwnerId: 'owner-1',
      dataOwnerKind: 'registered',
    } as never);
    vi.mocked(listWorkspaceResourceSummaries).mockResolvedValue({
      items: [],
      nextCursor: null,
    });
    const response = await GET(
      new Request(
        'http://localhost/api/v1/canvas/resources?filter=source&limit=63&cursor=c1',
      ),
    );
    expect(response.status).toBe(200);
    expect(readEffectiveSubject).toHaveBeenCalledTimes(1);
    expect(listWorkspaceResourceSummaries).toHaveBeenCalledWith({
      dataOwnerKind: 'registered',
      dataOwnerId: 'owner-1',
      filter: 'source',
      limit: 63,
      cursor: 'c1',
    });
  });

  it('keeps invalid cursors distinct from a missing owned workspace', async () => {
    vi.mocked(readEffectiveSubject).mockResolvedValue({
      dataOwnerId: 'owner-1',
      dataOwnerKind: 'registered',
    } as never);
    vi.mocked(listWorkspaceResourceSummaries).mockRejectedValueOnce(
      new WorkspaceResourceReadModelError('invalid_cursor'),
    );
    expect(
      (
        await GET(
          new Request('http://localhost/api/v1/canvas/resources?cursor=bad'),
        )
      ).status,
    ).toBe(400);
    vi.mocked(listWorkspaceResourceSummaries).mockRejectedValueOnce(
      new WorkspaceResourceReadModelError('resource_not_found'),
    );
    expect(
      (await GET(new Request('http://localhost/api/v1/canvas/resources')))
        .status,
    ).toBe(404);
  });
});
