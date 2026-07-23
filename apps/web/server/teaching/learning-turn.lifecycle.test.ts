import type { TurnApplicationCommand } from '@educanvas/agent-core';
import type {
  ChatMessageSnapshot,
  MessageCitationSnapshot,
  TeachingApplicationTurnLedgerSnapshot,
} from '@educanvas/db';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AnonymousIdentity } from '../identity/anonymous-identity';
import { WebTeachingLifecycle } from './turn-application/lifecycle';
import { webTeachingPersistence } from './turn-application/persistence';

vi.mock('server-only', () => ({}));

const identity: AnonymousIdentity = {
  token: 'test-token',
  studentId: 'student-1',
};
const command: TurnApplicationCommand = {
  protocol: 'educanvas.turn.v2',
  operationId: 'turn-1',
  traceId: 'trace-1',
  actor: { actorId: identity.studentId, agentId: 'agent-1' },
  notebook: { notebookId: 'notebook-1', conversationId: 'conversation-1' },
  profile: { profileId: 'k12.teacher' },
  entrypoint: 'web',
  input: {
    clientMessageId: 'client-message-1',
    parts: [{ type: 'text', text: '请解释这个知识点' }],
  },
  capabilities: [],
};

function message(
  role: ChatMessageSnapshot['role'],
  status: ChatMessageSnapshot['status'],
): ChatMessageSnapshot {
  const assistant = role === 'assistant';
  return {
    id: assistant ? 'assistant-message-1' : 'user-message-1',
    sessionId: 'session-1',
    turnId: command.operationId,
    clientMessageId: assistant ? null : command.input.clientMessageId,
    role,
    status,
    content: assistant ? '答案正文' : '学生问题',
    parts: [{ type: 'text', text: assistant ? '答案正文' : '学生问题' }],
    failureCode: null,
    createdAt: '2026-07-23T00:00:00.000Z',
    completedAt: '2026-07-23T00:00:01.000Z',
    cancelRequestedAt: null,
    cancelledAt: null,
    leaseId: assistant ? 'lease-1' : null,
    leaseExpiresAt: null,
    heartbeatAt: null,
  };
}

const citation: MessageCitationSnapshot = {
  id: 'citation-1',
  assistantMessageId: 'assistant-message-1',
  candidateId: 'candidate-1',
  ordinal: 1,
  sourceId: 'source-1',
  sourceTitle: '教材',
  documentId: 'document-1',
  documentVersion: 1,
  documentContentHash: 'a'.repeat(64),
  chunkId: 'chunk-1',
  chunkContentHash: 'b'.repeat(64),
  heading: null,
  pageStart: 8,
  pageEnd: 8,
  availability: 'available',
  text: '教材正文',
  createdAt: '2026-07-23T00:00:00.000Z',
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('WebTeachingLifecycle characterization', () => {
  it('completed replay 保持正文、引用、终态的既有顺序', async () => {
    const snapshot: TeachingApplicationTurnLedgerSnapshot = {
      replayed: true,
      turn: {
        turnId: command.operationId,
        studentMessage: message('student', 'completed'),
        assistantMessage: message('assistant', 'completed'),
      },
      leaseId: 'lease-1',
    };
    vi.spyOn(
      webTeachingPersistence.ledger,
      'beginApplicationTurn',
    ).mockResolvedValue(snapshot);
    vi.spyOn(
      webTeachingPersistence.knowledge,
      'listOwnedMessageCitations',
    ).mockResolvedValue([citation]);
    const lifecycle = new WebTeachingLifecycle(identity, 'session-1');

    await lifecycle.begin(command);
    const events = await lifecycle.replay();

    expect(events.map((event) => event.type)).toEqual([
      'message.delta',
      'message.citation',
      'turn.completed',
    ]);
    expect(events[1]).toMatchObject({
      operationId: command.operationId,
      messageId: 'assistant-message-1',
      citationId: citation.id,
      marker: 1,
      label: '教材 · 第8页',
    });
    expect(events[2]).toMatchObject({
      operationId: command.operationId,
      messageId: 'assistant-message-1',
    });
  });
});
