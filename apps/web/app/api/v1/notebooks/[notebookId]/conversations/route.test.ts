import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('@educanvas/db', () => ({
  DrizzlePlatformConversationRepository: vi.fn(),
}));
vi.mock('@/server/identity/anonymous-identity', () => ({
  readAnonymousIdentity: vi.fn(),
}));
vi.mock('@/server/platform/general-conversation', () => ({
  isValidConversationId: (value: string) => /^[0-9a-f-]{36}$/i.test(value),
  writeActiveConversationCookie: vi.fn(),
}));
import { DrizzlePlatformConversationRepository } from '@educanvas/db';
import { readAnonymousIdentity } from '@/server/identity/anonymous-identity';
import { writeActiveConversationCookie } from '@/server/platform/general-conversation';
import { GET, POST } from './route';
const notebookId = '11111111-1111-4111-8111-111111111111';
const conversationId = '22222222-2222-4222-8222-222222222222';
const context = { params: Promise.resolve({ notebookId }) };
const getNotebook = vi.fn();
const getOwned = vi.fn();
const listInNotebook = vi.fn();
const createInNotebook = vi.fn();
function request(body: unknown = {}) {
  return new Request(
    `http://localhost/api/v1/notebooks/${notebookId}/conversations`,
    {
      method: 'POST',
      headers: {
        origin: 'http://localhost',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    },
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(DrizzlePlatformConversationRepository).mockImplementation(
    function () {
      return { getNotebook, getOwned, listInNotebook, createInNotebook };
    } as never,
  );
  vi.mocked(readAnonymousIdentity).mockResolvedValue({
    studentId: 'owner',
    token: '',
  });
  getNotebook.mockResolvedValue({
    id: notebookId,
    permissions: ['notebook.read', 'conversation.create', 'notebook.manage'],
  });
  getOwned.mockResolvedValue({
    id: conversationId,
    spaceId: notebookId,
    agentProfileId: 'general',
  });
  listInNotebook.mockResolvedValue([
    { id: conversationId, spaceId: notebookId, agentProfileId: 'general' },
  ]);
  createInNotebook.mockResolvedValue({
    id: conversationId,
    spaceId: notebookId,
    agentProfileId: 'general',
  });
});
describe('Notebook conversation directory', () => {
  it('lists only the explicit notebook and derives permissions on the server', async () => {
    const result = await GET(request(), context);
    expect(result.status).toBe(200);
    expect(listInNotebook).toHaveBeenCalledWith({
      notebookId,
      trustedSubjectId: 'owner',
    });
    expect(await result.json()).toMatchObject({
      canCreate: true,
      canManage: true,
    });
  });
  it('creates a general child conversation within the existing notebook', async () => {
    const result = await POST(request({ title: '几何' }), context);
    expect(result.status).toBe(201);
    expect(createInNotebook).toHaveBeenCalledWith({
      notebookId,
      trustedSubjectId: 'owner',
      title: '几何',
    });
  });
  it('denies readonly membership before creating a conversation', async () => {
    getNotebook.mockResolvedValue({ permissions: ['notebook.read'] });
    expect((await POST(request(), context)).status).toBe(404);
    expect(createInNotebook).not.toHaveBeenCalled();
  });
  it('rejects a conversation from a different notebook without changing the cookie', async () => {
    getOwned.mockResolvedValue({
      id: conversationId,
      spaceId: 'another-notebook',
      agentProfileId: 'general',
    });
    expect((await POST(request({ conversationId }), context)).status).toBe(404);
    expect(writeActiveConversationCookie).not.toHaveBeenCalled();
  });
  it('rejects a teaching profile on the general conversation entry', async () => {
    getOwned.mockResolvedValue({
      id: conversationId,
      spaceId: notebookId,
      agentProfileId: 'k12',
    });
    expect((await POST(request({ conversationId }), context)).status).toBe(404);
    expect(writeActiveConversationCookie).not.toHaveBeenCalled();
  });
  it('keeps nonexistent, invalid and revoked notebooks indistinguishable', async () => {
    getNotebook.mockResolvedValue(null);
    expect((await GET(request(), context)).status).toBe(404);
    expect(
      (await GET(request(), { params: Promise.resolve({ notebookId: 'bad' }) }))
        .status,
    ).toBe(404);
    expect(listInNotebook).not.toHaveBeenCalled();
  });
  it('rejects cross-origin mutations before accessing the directory', async () => {
    const crossOrigin = new Request(
      `http://localhost/api/v1/notebooks/${notebookId}/conversations`,
      {
        method: 'POST',
        headers: { origin: 'http://evil.invalid' },
        body: '{}',
      },
    );
    expect((await POST(crossOrigin, context)).status).toBe(403);
    expect(getNotebook).not.toHaveBeenCalled();
  });
});
