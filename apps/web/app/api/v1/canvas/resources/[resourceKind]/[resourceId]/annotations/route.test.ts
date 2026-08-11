import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/server/identity/anonymous-identity', () => ({
  readAnonymousIdentity: vi.fn(),
}));
vi.mock('@/server/platform/general-conversation', () => ({
  loadOwnedGeneralConversation: vi.fn(),
}));
vi.mock('@/server/canvas/resource-annotations', () => ({
  createOwnedResourceAnnotation: vi.fn(),
  listOwnedResourceAnnotations: vi.fn(),
}));

import { readAnonymousIdentity } from '@/server/identity/anonymous-identity';
import { loadOwnedGeneralConversation } from '@/server/platform/general-conversation';
import {
  createOwnedResourceAnnotation,
  listOwnedResourceAnnotations,
} from '@/server/canvas/resource-annotations';
import { GET, POST } from './route';

const resourceId = '10000000-0000-4000-8000-000000000001';
const notebookId = '20000000-0000-4000-8000-000000000002';
const context = {
  params: Promise.resolve({ resourceKind: 'source', resourceId }),
};

describe('resource annotation route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readAnonymousIdentity).mockResolvedValue({
      token: 'token',
      studentId: 'owner-1',
    });
    vi.mocked(loadOwnedGeneralConversation).mockResolvedValue({
      id: 'conversation-1',
      spaceId: notebookId,
    } as never);
    vi.mocked(listOwnedResourceAnnotations).mockResolvedValue([]);
    vi.mocked(createOwnedResourceAnnotation).mockResolvedValue({
      id: '30000000-0000-4000-8000-000000000003',
    } as never);
  });

  it('lists only through trusted identity and current Notebook', async () => {
    const response = await GET(new Request('http://localhost'), context);
    expect(response.status).toBe(200);
    expect(listOwnedResourceAnnotations).toHaveBeenCalledWith({
      identity: { token: 'token', studentId: 'owner-1' },
      notebookId,
      resourceKind: 'source',
      resourceId,
    });
  });

  it('requires same-origin and validates normalized payloads', async () => {
    const forbidden = await POST(
      new Request('http://localhost', {
        method: 'POST',
        headers: {
          origin: 'https://evil.example',
          'content-type': 'application/json',
        },
        body: '{}',
      }),
      context,
    );
    expect(forbidden.status).toBe(403);

    const accepted = await POST(
      new Request('http://localhost', {
        method: 'POST',
        headers: {
          origin: 'http://localhost',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          kind: 'circle',
          geometry: { x: 0.2, y: 0.3, width: 0.18, height: 0.13 },
          source: 'voice',
        }),
      }),
      context,
    );
    expect(accepted.status).toBe(201);
    expect(createOwnedResourceAnnotation).toHaveBeenCalledWith(
      expect.objectContaining({
        notebookId,
        resourceId,
        annotation: expect.objectContaining({ source: 'voice' }),
      }),
    );
  });
});
