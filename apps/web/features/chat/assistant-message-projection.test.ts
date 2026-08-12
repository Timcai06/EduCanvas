import { describe, expect, it } from 'vitest';
import type { AssistantMessage, StudentMessage } from './messages';
import { projectAssistantMessage } from './assistant-message-projection';
import { createTeachingTurnState, teachingTurnReducer } from './turn-state';

function assistant(
  overrides: Partial<AssistantMessage> = {},
): AssistantMessage {
  return {
    id: `msg-${crypto.randomUUID().slice(0, 8)}`,
    turnId: 'turn-1',
    clientMessageId: `client-${crypto.randomUUID().slice(0, 8)}`,
    role: 'assistant',
    status: 'completed',
    text: '',
    attachments: [],
    ...overrides,
  };
}

function student(overrides: Partial<StudentMessage> = {}): StudentMessage {
  return {
    id: `msg-${crypto.randomUUID().slice(0, 8)}`,
    turnId: 'turn-1',
    clientMessageId: `client-${crypto.randomUUID().slice(0, 8)}`,
    role: 'student',
    status: 'completed',
    text: 'hello',
    attachments: [],
    ...overrides,
  };
}

describe('projectAssistantMessage', () => {
  it('returns null identity when messages is empty', () => {
    const result = projectAssistantMessage([]);
    expect(result.assistantId).toBeNull();
    expect(result.assistantText).toBeNull();
    expect(result.assistantStatus).toBeNull();
    expect(result.assistantArtifacts).toEqual([]);
    expect(result.assistantCitations).toEqual([]);
  });

  it('returns null identity when only student messages exist', () => {
    const result = projectAssistantMessage([
      student({ text: 'hello' }),
      student({ text: 'world' }),
    ]);
    expect(result.assistantId).toBeNull();
    expect(result.assistantText).toBeNull();
  });

  it('extracts the LAST assistant message identity and text', () => {
    const msg1 = assistant({
      id: 'a1',
      clientMessageId: 'cid-1',
      text: 'first answer',
      status: 'completed',
    });
    const msg2 = assistant({
      id: 'a2',
      clientMessageId: 'cid-2',
      text: 'second answer',
      status: 'streaming',
    });
    const result = projectAssistantMessage([
      student({ id: 's1' }),
      msg1,
      student({ id: 's2' }),
      msg2,
    ]);
    expect(result.assistantId).toBe('cid-2');
    expect(result.assistantText).toBe('second answer');
    expect(result.assistantStatus).toBe('streaming');
  });

  it('projects the same stable identity while reducer message.delta grows text', () => {
    let state = teachingTurnReducer(createTeachingTurnState([]), {
      type: 'send.started',
      clientMessageId: 'cid-1',
      text: '请解释这个概念',
    });
    const pending = projectAssistantMessage(state.messages);
    expect(pending).toMatchObject({
      assistantId: 'cid-1',
      assistantText: '',
      assistantStatus: 'pending',
    });

    state = teachingTurnReducer(state, {
      type: 'stream.event',
      event: {
        type: 'turn.accepted',
        schemaVersion: '1',
        turnId: 'turn-current',
        studentMessageId: 'student-current',
        assistantMessageId: 'assistant-current',
        replayed: false,
      },
    });
    for (const delta of ['先看定义。', '再比较两个例子。']) {
      state = teachingTurnReducer(state, {
        type: 'stream.event',
        event: {
          type: 'message.delta',
          schemaVersion: '1',
          turnId: 'turn-current',
          messageId: 'assistant-current',
          delta,
        },
      });
    }

    expect(projectAssistantMessage(state.messages)).toMatchObject({
      assistantId: 'cid-1',
      assistantText: '先看定义。再比较两个例子。',
      assistantStatus: 'streaming',
    });
  });

  it('historical assistant messages are not mistaken for current turn (evidence 6)', () => {
    const oldMsg = assistant({
      id: 'a-old',
      turnId: 'turn-old',
      clientMessageId: 'cid-old',
      text: 'old answer',
      status: 'completed',
    });
    const newMsg = assistant({
      id: 'a-new',
      turnId: 'turn-new',
      clientMessageId: 'cid-new',
      text: 'new answer',
      status: 'streaming',
    });
    const result = projectAssistantMessage([
      oldMsg,
      student({ id: 's1', turnId: 'turn-new' }),
      newMsg,
    ]);
    expect(result.assistantId).toBe('cid-new');
    expect(result.assistantText).toBe('new answer');
    expect(result.assistantStatus).toBe('streaming');
  });

  it('a new Turn placeholder supersedes the historical Assistant before any delta', () => {
    const initial = [
      {
        id: 'assistant-old',
        turnId: 'turn-old',
        clientMessageId: 'client-old',
        role: 'assistant' as const,
        status: 'completed' as const,
        content: '旧回答',
        parts: [],
        citations: [],
        artifacts: [],
        failureCode: null,
        createdAt: '2026-08-12T00:00:00.000Z',
        completedAt: '2026-08-12T00:00:01.000Z',
      },
    ];
    const state = teachingTurnReducer(createTeachingTurnState(initial), {
      type: 'send.started',
      clientMessageId: 'client-current',
      text: '新问题',
    });

    expect(projectAssistantMessage(state.messages)).toMatchObject({
      assistantId: 'client-current',
      assistantText: '',
      assistantStatus: 'pending',
    });
  });

  it('leaving and re-entering Live reuses the ledger projection without duplication', () => {
    let state = teachingTurnReducer(createTeachingTurnState([]), {
      type: 'send.started',
      clientMessageId: 'client-current',
      text: '继续解释',
    });
    state = teachingTurnReducer(state, {
      type: 'stream.event',
      event: {
        type: 'turn.accepted',
        schemaVersion: '1',
        turnId: 'turn-current',
        studentMessageId: 'student-current',
        assistantMessageId: 'assistant-current',
        replayed: false,
      },
    });
    state = teachingTurnReducer(state, {
      type: 'stream.event',
      event: {
        type: 'message.delta',
        schemaVersion: '1',
        turnId: 'turn-current',
        messageId: 'assistant-current',
        delta: '第一段。',
      },
    });

    const beforeExit = projectAssistantMessage(state.messages);
    const afterReentry = projectAssistantMessage(state.messages);
    expect(afterReentry).toEqual(beforeExit);

    state = teachingTurnReducer(state, {
      type: 'stream.event',
      event: {
        type: 'message.delta',
        schemaVersion: '1',
        turnId: 'turn-current',
        messageId: 'assistant-current',
        delta: '第二段。',
      },
    });
    expect(projectAssistantMessage(state.messages)).toMatchObject({
      assistantId: 'client-current',
      assistantText: '第一段。第二段。',
    });
  });

  it('TTS silence/failure does not clear visual text (evidence 5)', () => {
    const msg = assistant({
      id: 'a1',
      clientMessageId: 'cid-1',
      text: 'visible text',
      status: 'completed',
    });
    const result = projectAssistantMessage([student({ id: 's1' }), msg]);
    // status is 'completed', text is still present
    expect(result.assistantText).toBe('visible text');
    expect(result.assistantStatus).toBe('completed');
  });

  it('returns artifacts from the latest assistant message', () => {
    const msg = assistant({
      id: 'a1',
      clientMessageId: 'cid-1',
      text: 'done',
      artifacts: [
        {
          id: 'art-1',
          kind: 'mind_map',
          title: 'Map',
          status: 'active',
          latestVersion: 1,
        },
      ],
    });
    const result = projectAssistantMessage([student({ id: 's1' }), msg]);
    expect(result.assistantArtifacts).toHaveLength(1);
    expect(result.assistantArtifacts[0]!.id).toBe('art-1');
  });

  it('returns citations from the latest assistant message', () => {
    const msg = assistant({
      id: 'a1',
      clientMessageId: 'cid-1',
      text: 'cited',
      citations: [
        {
          id: 'cite-1',
          kind: 'web' as const,
          label: 'Source',
          url: 'https://example.com',
          assetId: 'asset-1',
          assetVersionId: 'av-1',
          pageStart: 1,
          pageEnd: 1,
        },
      ],
    });
    const result = projectAssistantMessage([student({ id: 's1' }), msg]);
    expect(result.assistantCitations).toHaveLength(1);
    expect(result.assistantCitations[0]!.id).toBe('cite-1');
  });
});
