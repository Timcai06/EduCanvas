import type {
  TurnApplicationCommand,
  TurnApplicationEvent,
} from '@educanvas/agent-core';
import type {
  BuiltAssetContext,
  TurnApplicationLifecycleSnapshot,
} from '@educanvas/agent-runtime';
import type { MessageCitationSnapshot } from '@educanvas/db';
import type { LessonSessionSnapshot } from '@educanvas/teaching-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AnonymousIdentity } from '../identity/anonymous-identity';
import { webTeachingPersistence } from './turn-application/persistence';
import { WebTeachingProfile } from './turn-application/profile';

vi.mock('server-only', () => ({}));

const identity: AnonymousIdentity = {
  token: 'test-token',
  studentId: 'student-1',
};
const session: LessonSessionSnapshot = {
  id: 'session-1',
  studentId: identity.studentId,
  knowledgeNodeId: 'knowledge-node-1',
  state: 'EXPLAIN',
  interruptedState: null,
  version: 1,
};
const assetContext: BuiltAssetContext = {
  text: '',
  textSegments: [],
  nativeReferences: [],
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
const turn: TurnApplicationLifecycleSnapshot = {
  operationId: command.operationId,
  traceId: command.traceId,
  userMessageId: 'user-message-1',
  assistantMessageId: 'assistant-message-1',
  replayed: false,
};
const citation: MessageCitationSnapshot = {
  id: 'citation-1',
  assistantMessageId: turn.assistantMessageId,
  candidateId: 'candidate-2',
  ordinal: 2,
  sourceId: 'source-1',
  sourceTitle: '课程讲义',
  documentId: 'document-1',
  documentVersion: 1,
  documentContentHash: 'a'.repeat(64),
  chunkId: 'chunk-1',
  chunkContentHash: 'b'.repeat(64),
  heading: null,
  pageStart: 3,
  pageEnd: 4,
  availability: 'available',
  text: '引用正文',
  createdAt: '2026-07-23T00:00:00.000Z',
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('WebTeachingProfile characterization', () => {
  it('在 prepare 前执行输入安全 preflight 并原样记录五维决策', async () => {
    const record = vi
      .spyOn(webTeachingPersistence.safetyDecisions, 'record')
      .mockResolvedValue({
        replayed: false,
        decision: {
          sessionId: session.id,
          turnId: command.operationId,
          phase: 'input',
          policyVersion: 'k12-safety-v1',
          category: 'normal',
          action: 'block',
          detectorVersion: 'deterministic-k12-detector-v1',
          createdAt: '2026-07-23T00:00:00.000Z',
        },
      });
    const profile = new WebTeachingProfile(identity, session, assetContext);

    const result = await profile.preflight({
      command: {
        ...command,
        input: {
          ...command.input,
          parts: [{ type: 'text', text: '   ' }],
        },
      },
      turn,
    });

    expect(result).toMatchObject({
      kind: 'reject',
      failureCode: 'POLICY_BLOCKED',
    });
    expect(record).toHaveBeenCalledWith({
      trustedStudentId: identity.studentId,
      sessionId: session.id,
      turnId: command.operationId,
      phase: 'input',
      policyVersion: 'k12-safety-v1',
      category: 'normal',
      action: 'block',
      detectorVersion: 'deterministic-k12-detector-v1',
    });
  });

  it('finalize 只持久化正文实际标记的候选并投影引用事件', async () => {
    const persist = vi
      .spyOn(webTeachingPersistence.knowledge, 'persistMessageCitations')
      .mockResolvedValue({ replayed: false, citations: [citation] });
    const profile = new WebTeachingProfile(identity, session, assetContext);
    profile.collectKnowledgeEvidence(['candidate-1', 'candidate-2']);

    const result = await profile.finalize({
      command,
      turn,
      content: '根据课程讲义可知结论。[2]',
    });

    expect(persist).toHaveBeenCalledWith({
      trustedStudentId: identity.studentId,
      sessionId: session.id,
      turnId: command.operationId,
      assistantMessageId: turn.assistantMessageId,
      candidateIds: ['candidate-2'],
      markers: [2],
    });
    expect(result.events).toEqual([
      expect.objectContaining<Partial<TurnApplicationEvent>>({
        operationId: command.operationId,
        type: 'message.citation',
        messageId: turn.assistantMessageId,
        citationId: citation.id,
        marker: 2,
        label: '课程讲义 · 第3-4页',
      }),
    ]);
  });
});
