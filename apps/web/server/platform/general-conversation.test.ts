import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({
  getOwned: vi.fn(),
  listMessages: vi.fn(),
  listCitations: vi.fn(),
  listReferences: vi.fn(),
}));
vi.mock('@educanvas/db', () => ({
  DrizzlePlatformConversationRepository: class {
    getOwned = mocks.getOwned;
  },
  DrizzlePlatformTurnRepository: class {
    listMessages = mocks.listMessages;
  },
  DrizzlePlatformSourceRepository: class {
    listOwnedConversationCitations = mocks.listCitations;
  },
  DrizzlePlatformArtifactTurnReferenceRepository: class {
    listForOperations = mocks.listReferences;
  },
}));
vi.mock('next/headers', () => ({ cookies: vi.fn() }));
vi.mock('@/server/identity/anonymous-identity', () => ({
  readAnonymousIdentity: vi.fn(),
}));
import { readAnonymousIdentity } from '@/server/identity/anonymous-identity';
import {
  loadGeneralChatPageData,
  notebookConversationPath,
} from './general-conversation';
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(readAnonymousIdentity).mockResolvedValue({
    studentId: 'owner',
    token: '',
  });
  mocks.getOwned.mockResolvedValue({
    id: 'chat-a',
    spaceId: 'notebook-a',
    agentProfileId: 'general',
  });
  mocks.listMessages.mockResolvedValue([]);
  mocks.listCitations.mockResolvedValue([]);
  mocks.listReferences.mockResolvedValue([]);
});
describe('explicit Notebook page projection', () => {
  it('loads the exact authorized conversation independent of the legacy cookie', async () => {
    const data = await loadGeneralChatPageData({
      notebookId: 'notebook-a',
      conversationId: 'chat-a',
    });
    expect(data?.conversation.id).toBe('chat-a');
    expect(mocks.getOwned).toHaveBeenCalledWith({
      conversationId: 'chat-a',
      trustedSubjectId: 'owner',
    });
    expect(mocks.listMessages).toHaveBeenCalledWith({
      conversationId: 'chat-a',
      trustedSubjectId: 'owner',
      limit: 100,
    });
  });
  it('does not read message or citation contents across Notebook boundaries', async () => {
    expect(
      await loadGeneralChatPageData({
        notebookId: 'notebook-b',
        conversationId: 'chat-a',
      }),
    ).toBeNull();
    expect(mocks.listMessages).not.toHaveBeenCalled();
    expect(mocks.listCitations).not.toHaveBeenCalled();
  });
  it('keeps teaching profiles outside the general conversation projection', async () => {
    mocks.getOwned.mockResolvedValue({
      id: 'chat-a',
      spaceId: 'notebook-a',
      agentProfileId: 'k12.teacher',
    });
    expect(
      await loadGeneralChatPageData({
        notebookId: 'notebook-a',
        conversationId: 'chat-a',
      }),
    ).toBeNull();
    expect(mocks.listMessages).not.toHaveBeenCalled();
  });
  it('routes legacy courses to their existing Notebook without changing identifiers', () => {
    expect(
      notebookConversationPath({
        id: 'chat-a',
        spaceId: 'old-course',
        agentProfileId: 'k12.teacher',
      }),
    ).toBe('/notebook/old-course/learn');
    expect(
      notebookConversationPath({
        id: 'chat-a',
        spaceId: 'notebook-a',
        agentProfileId: 'general',
      }),
    ).toBe('/notebook/notebook-a/conversation/chat-a');
  });
});
