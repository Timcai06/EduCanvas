import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/server/identity/anonymous-identity', () => ({
  readAnonymousIdentity: vi.fn(),
}));
vi.mock('@/server/platform/general-conversation', () => ({
  loadOwnedGeneralConversation: vi.fn(),
}));
vi.mock('@/server/canvas/resource-access', async () => {
  const actual = await vi.importActual<
    typeof import('@/server/canvas/resource-access')
  >('@/server/canvas/resource-access');
  return { ...actual, loadOwnedCanvasResource: vi.fn() };
});

import { readAnonymousIdentity } from '@/server/identity/anonymous-identity';
import { loadOwnedGeneralConversation } from '@/server/platform/general-conversation';
import {
  CanvasResourceAccessError,
  loadOwnedCanvasResource,
} from '@/server/canvas/resource-access';
import { GET } from './route';

const resourceId = '10000000-0000-4000-8000-000000000001';
const identity = { token: 'token', studentId: 'owner-1' };
const notebookId = '20000000-0000-4000-8000-000000000002';

describe('GET /api/v1/canvas/resources/[resourceKind]/[resourceId]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readAnonymousIdentity).mockResolvedValue(identity);
    vi.mocked(loadOwnedGeneralConversation).mockResolvedValue({
      id: 'conversation-1',
      spaceId: notebookId,
    } as never);
    vi.mocked(loadOwnedCanvasResource).mockResolvedValue({
      resourceId,
      notebookId,
    } as never);
  });

  it('uses only the trusted identity and current Notebook route', async () => {
    const response = await GET(new Request('http://localhost'), {
      params: Promise.resolve({ resourceKind: 'source', resourceId }),
    });

    expect(response.status).toBe(200);
    expect(loadOwnedCanvasResource).toHaveBeenCalledWith({
      identity,
      notebookId,
      resourceKind: 'source',
      resourceId,
    });
  });

  it('returns one resource_not_found shape for invalid, missing and unauthorized resources', async () => {
    const invalid = await GET(new Request('http://localhost'), {
      params: Promise.resolve({
        resourceKind: 'source',
        resourceId: 'invalid',
      }),
    });
    expect(invalid.status).toBe(404);
    await expect(invalid.json()).resolves.toMatchObject({
      error: { code: 'resource_not_found' },
    });

    vi.mocked(loadOwnedCanvasResource).mockRejectedValue(
      new CanvasResourceAccessError('resource_not_found', 404),
    );
    const denied = await GET(new Request('http://localhost'), {
      params: Promise.resolve({ resourceKind: 'artifact', resourceId }),
    });
    expect(denied.status).toBe(404);
    await expect(denied.json()).resolves.toMatchObject({
      error: { code: 'resource_not_found' },
    });
  });
});
