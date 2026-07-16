import { describe, expect, it } from 'vitest';
import type { InitialChatMessageDTO } from './messages';
import { createTeachingTurnState, teachingTurnReducer } from './turn-state';

function accepted(turnId = 'turn-1') {
  return {
    type: 'turn.accepted' as const,
    schemaVersion: '1' as const,
    turnId,
    studentMessageId: 'student-1',
    assistantMessageId: 'assistant-1',
    replayed: false,
  };
}

describe('teaching turn browser state machine', () => {
  it('advances pending -> streaming -> completed and ignores a late delta', () => {
    let state = teachingTurnReducer(createTeachingTurnState([]), {
      type: 'send.started',
      clientMessageId: 'client-1',
      text: '为什么要看耳朵？',
    });
    expect(state.active?.status).toBe('pending');
    expect(state.announcement?.text).toBe('AI 老师开始回答');

    state = teachingTurnReducer(state, {
      type: 'stream.event',
      event: accepted(),
    });
    state = teachingTurnReducer(state, {
      type: 'stream.event',
      event: {
        type: 'message.delta',
        schemaVersion: '1',
        turnId: 'turn-1',
        messageId: 'assistant-1',
        delta: '因为耳朵形状是明显特征。',
      },
    });
    expect(state.active?.status).toBe('streaming');
    expect(state.messages.at(-1)).toMatchObject({
      status: 'streaming',
      text: '因为耳朵形状是明显特征。',
    });

    state = teachingTurnReducer(state, {
      type: 'stream.event',
      event: {
        type: 'message.citation',
        schemaVersion: '1',
        turnId: 'turn-1',
        messageId: 'assistant-1',
        citationId: 'citation-1',
        sourceId: 'source-1',
        documentId: 'document-1',
        chunkId: 'chunk-1',
        label: '课程讲义 · 第3页',
        pageStart: 3,
        pageEnd: 3,
      },
    });
    expect(state.messages.at(-1)).toMatchObject({
      citations: [{ id: 'citation-1', label: '课程讲义 · 第3页' }],
    });

    state = teachingTurnReducer(state, {
      type: 'stream.event',
      event: {
        type: 'turn.completed',
        schemaVersion: '1',
        turnId: 'turn-1',
        messageId: 'assistant-1',
      },
    });
    expect(state.active).toBeNull();
    expect(state.messages.at(-1)?.status).toBe('completed');
    expect(state.announcement?.text).toBe('AI 老师回答完成');

    const completedState = state;
    state = teachingTurnReducer(state, {
      type: 'stream.event',
      event: {
        type: 'message.delta',
        schemaVersion: '1',
        turnId: 'turn-1',
        messageId: 'assistant-1',
        delta: '不应出现',
      },
    });
    expect(state).toBe(completedState);
  });

  it('maps interrupted failures and retains the source text for retry', () => {
    let state = teachingTurnReducer(createTeachingTurnState([]), {
      type: 'send.started',
      clientMessageId: 'client-1',
      text: '再解释一次',
    });
    state = teachingTurnReducer(state, {
      type: 'stream.event',
      event: accepted(),
    });
    state = teachingTurnReducer(state, {
      type: 'stream.event',
      event: {
        type: 'turn.failed',
        schemaVersion: '1',
        turnId: 'turn-1',
        messageId: 'assistant-1',
        code: 'interrupted',
        message: '回答意外中断了。',
        retryable: true,
      },
    });

    expect(state.messages.at(-1)).toMatchObject({
      status: 'interrupted',
      retryText: '再解释一次',
      retryable: true,
    });
    expect(state.announcement?.text).toBe('AI 老师回答失败');
  });

  it('hydrates persisted terminal messages without inventing an active stream', () => {
    const initial: InitialChatMessageDTO[] = [
      {
        id: 'student-1',
        turnId: 'turn-1',
        clientMessageId: 'client-1',
        role: 'student',
        status: 'completed',
        content: '继续讲',
        failureCode: null,
        createdAt: '2026-07-15T00:00:00.000Z',
        completedAt: '2026-07-15T00:00:00.000Z',
      },
      {
        id: 'assistant-1',
        turnId: 'turn-1',
        clientMessageId: 'client-1',
        role: 'assistant',
        status: 'interrupted',
        content: '我们先看',
        failureCode: 'interrupted',
        createdAt: '2026-07-15T00:00:00.000Z',
        completedAt: null,
      },
    ];

    const state = createTeachingTurnState(initial);

    expect(state.active).toBeNull();
    expect(state.messages.at(-1)).toMatchObject({
      status: 'interrupted',
      retryText: '继续讲',
    });
  });
});
