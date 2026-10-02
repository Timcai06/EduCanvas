import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({
  getOwned: vi.fn(),
  listMessages: vi.fn(),
  listCitations: vi.fn(),
  listReferences: vi.fn(),
  listConfirmations: vi.fn(),
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
  DrizzleArtifactConfirmationRepository: class {
    listRecoverable = mocks.listConfirmations;
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
  mocks.listConfirmations.mockResolvedValue([]);
});
describe('explicit Notebook page projection', () => {
  it('refresh restores a consumed confirmation when runtime start failed before artifacts exist', async () => {
    const confirmationId = '11111111-1111-4111-8111-111111111111';
    mocks.listMessages.mockResolvedValue([
      {
        id: 'assistant-proposal',
        operationId: 'operation-proposal',
        clientMessageId: 'proposal-message',
        role: 'assistant',
        status: 'completed',
        content: '建议创建Slides',
        parts: [],
        failureCode: null,
        createdAt: new Date(0),
        completedAt: new Date(0),
      },
    ]);
    mocks.listConfirmations.mockResolvedValue([
      {
        id: confirmationId,
        operationId: 'operation-proposal',
        userMessageId: 'proposal-user',
        actorUserId: 'owner',
        notebookId: 'notebook-a',
        conversationId: 'chat-a',
        artifactKind: 'mind_map',
        title: 'Slides建议',
        status: 'confirmed',
        confirmedKind: 'slides',
        confirmationMessageId: `artifact.confirm.${confirmationId.replaceAll('-', '')}`,
        createdAt: new Date(0).toISOString(),
      },
    ]);

    const data = await loadGeneralChatPageData({
      notebookId: 'notebook-a',
      conversationId: 'chat-a',
    });

    expect(data?.initialMessages[0]?.artifactConfirmation).toEqual({
      id: confirmationId,
      kind: 'slides',
      title: 'Slides建议',
      status: 'confirmed',
    });
  });

  it('hides the recovered card once the idempotent execution has an artifact receipt', async () => {
    const confirmationId = '11111111-1111-4111-8111-111111111111';
    const clientMessageId = `artifact.confirm.${confirmationId.replaceAll('-', '')}`;
    mocks.listMessages.mockResolvedValue([
      {
        id: 'assistant-proposal',
        operationId: 'operation-proposal',
        clientMessageId: 'proposal-message',
        role: 'assistant',
        status: 'completed',
        content: '建议创建Slides',
        parts: [],
        failureCode: null,
        createdAt: new Date(0),
        completedAt: new Date(0),
      },
      {
        id: 'execution-user',
        operationId: 'operation-execution',
        clientMessageId,
        role: 'user',
        status: 'completed',
        content: '确认创建',
        parts: [],
        failureCode: null,
        createdAt: new Date(0),
        completedAt: new Date(0),
      },
    ]);
    mocks.listReferences.mockResolvedValue([
      { operationId: 'operation-execution' },
    ]);
    mocks.listConfirmations.mockResolvedValue([
      {
        id: confirmationId,
        operationId: 'operation-proposal',
        userMessageId: 'proposal-user',
        actorUserId: 'owner',
        notebookId: 'notebook-a',
        conversationId: 'chat-a',
        artifactKind: 'mind_map',
        title: 'Slides建议',
        status: 'confirmed',
        confirmedKind: 'slides',
        confirmationMessageId: clientMessageId,
        createdAt: new Date(0).toISOString(),
      },
    ]);

    const data = await loadGeneralChatPageData({
      notebookId: 'notebook-a',
      conversationId: 'chat-a',
    });

    expect(data?.initialMessages[0]?.artifactConfirmation).toBeUndefined();
  });

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
