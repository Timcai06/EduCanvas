import { describe, expect, it } from 'vitest';
import {
  gatewayConversationCreateRequestSchema,
  gatewayConversationDirectoryPageSchema,
} from './conversation-directory';

describe('Gateway conversation directory contract', () => {
  it('accepts a versioned page with Notebook labels and stable ordering fields', () => {
    expect(
      gatewayConversationDirectoryPageSchema.parse({
        schemaVersion: 1,
        conversations: [
          {
            notebookId: 'notebook:one',
            notebookTitle: '数学笔记本',
            conversationId: 'conversation:one',
            title: '分数运算',
            agentProfileId: 'general',
            membershipRole: 'owner',
            lastActivityAt: '2026-08-13T07:00:00.000Z',
          },
        ],
        nextCursor: null,
      }),
    ).toMatchObject({ schemaVersion: 1, nextCursor: null });
  });

  it('bounds page size and requires an exact cursor shape', () => {
    expect(
      gatewayConversationDirectoryPageSchema.safeParse({
        schemaVersion: 1,
        conversations: [],
        nextCursor: 'not a cursor',
      }).success,
    ).toBe(false);
  });

  it('accepts only a Notebook and trimmed title for conversation creation', () => {
    expect(
      gatewayConversationCreateRequestSchema.parse({
        notebookId: 'notebook:one',
        title: '  新的学习对话  ',
      }),
    ).toEqual({
      notebookId: 'notebook:one',
      title: '新的学习对话',
    });
    expect(
      gatewayConversationCreateRequestSchema.safeParse({
        notebookId: 'notebook:one',
        title: '新对话',
        agentProfileId: 'admin',
      }).success,
    ).toBe(false);
  });
});
