import { describe, expect, it } from 'vitest';
import { createConversationCoordinator } from '../src/main/conversation-coordinator';
import type { StoredDesktopSession } from '../src/main/desktop-session-store';

const session: StoredDesktopSession = {
  version: 2,
  token: 'a'.repeat(32),
  expiresAt: '2099-01-01T00:00:00.000Z',
  webBaseUrl: 'https://web.example',
  gatewayBaseUrl: 'https://gateway.example',
  userId: 'user-1',
  initialCursor: { notebookId: 'notebook-1', conversationId: 'conversation-2' },
};

const entries = [
  {
    notebookId: 'notebook-1',
    notebookTitle: '数学',
    conversationId: 'conversation-1',
    title: '函数',
    agentProfileId: 'general' as const,
    membershipRole: 'owner' as const,
    lastActivityAt: '2026-08-13T10:00:00.000Z',
  },
  {
    notebookId: 'notebook-1',
    notebookTitle: '数学',
    conversationId: 'conversation-2',
    title: '几何',
    agentProfileId: 'general' as const,
    membershipRole: 'owner' as const,
    lastActivityAt: '2026-08-13T09:00:00.000Z',
  },
];

describe('desktop conversation coordinator', () => {
  it('loads all pages and keeps the signed-in initial conversation', async () => {
    let page = 0;
    const coordinator = createConversationCoordinator({
      getSession: async () => session,
      createClient: () => ({
        listConversationPage: async () => ({
          schemaVersion: 1 as const,
          conversations: [entries[page++]!],
          nextCursor: page === 1 ? 'gdc1.next' : null,
        }),
        createConversation: async () => ({
          schemaVersion: 1 as const,
          conversation: entries[0]!,
        }),
      }),
    });

    const state = await coordinator.load();
    expect(state.conversations).toEqual(entries);
    expect(state.currentConversationId).toBe('conversation-2');
    expect(coordinator.currentCursor()).toEqual(session.initialCursor);
  });

  it('switches and creates through one shared revisioned state', async () => {
    const created = {
      ...entries[0]!,
      conversationId: 'conversation-3',
      title: '新对话',
    };
    const coordinator = createConversationCoordinator({
      getSession: async () => session,
      createClient: () => ({
        listConversationPage: async () => ({
          schemaVersion: 1 as const,
          conversations: entries,
          nextCursor: null,
        }),
        createConversation: async () => ({
          schemaVersion: 1 as const,
          conversation: created,
        }),
      }),
    });
    await coordinator.load();
    const switched = coordinator.select('conversation-1');
    const result = await coordinator.create({
      notebookId: 'notebook-1',
      title: '新对话',
    });

    expect(switched.currentConversationId).toBe('conversation-1');
    expect(result.currentConversationId).toBe('conversation-3');
    expect(result.revision).toBeGreaterThan(switched.revision);
  });

  it('rejects a conversation outside the authorized directory', async () => {
    const coordinator = createConversationCoordinator({
      getSession: async () => session,
      createClient: () => ({
        listConversationPage: async () => ({
          schemaVersion: 1 as const,
          conversations: entries,
          nextCursor: null,
        }),
        createConversation: async () => ({
          schemaVersion: 1 as const,
          conversation: entries[0]!,
        }),
      }),
    });
    await coordinator.load();
    expect(() => coordinator.select('missing')).toThrow(
      'conversation_not_found',
    );
  });
});
