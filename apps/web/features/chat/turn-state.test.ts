import { describe, expect, it } from 'vitest';
import type { InitialChatMessageDTO } from './messages';
import {
  createTeachingTurnState,
  getRetryAssetParts,
  teachingTurnReducer,
} from './turn-state';

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
        marker: 3,
        sourceId: 'source-1',
        documentId: 'document-1',
        chunkId: 'chunk-1',
        label: '课程讲义 · 第3页',
        pageStart: 3,
        pageEnd: 3,
      },
    });
    expect(state.messages.at(-1)).toMatchObject({
      citations: [{ id: 'citation-1', marker: 3, label: '课程讲义 · 第3页' }],
    });

    state = teachingTurnReducer(state, {
      type: 'stream.event',
      event: {
        type: 'message.citation',
        schemaVersion: '1',
        turnId: 'turn-1',
        messageId: 'assistant-1',
        citationId: 'citation-web-1',
        marker: 2,
        kind: 'web',
        assetId: 'asset-1',
        assetVersionId: 'asset-version-1',
        label: '研究网页',
        url: 'https://example.com/research',
        pageStart: null,
        pageEnd: null,
      },
    });
    expect(state.messages.at(-1)).toMatchObject({
      citations: [
        { id: 'citation-1', marker: 3 },
        {
          id: 'citation-web-1',
          marker: 2,
          kind: 'web',
          url: 'https://example.com/research',
        },
      ],
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
    const assetPart = {
      type: 'asset_ref' as const,
      reference: {
        assetId: 'asset-1',
        versionId: 'version-1',
        kind: 'image' as const,
      },
      usage: 'attachment' as const,
    };
    let state = teachingTurnReducer(createTeachingTurnState([]), {
      type: 'send.started',
      clientMessageId: 'client-1',
      text: '再解释一次',
      parts: [{ type: 'text', text: '再解释一次' }, assetPart],
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
      retryParts: [{ type: 'text', text: '再解释一次' }, assetPart],
      retryable: true,
    });
    expect(state.announcement?.text).toBe('AI 老师回答失败');
    const assistant = state.messages.at(-1);
    if (!assistant || assistant.role !== 'assistant') {
      throw new Error('fixture assistant missing');
    }
    expect(getRetryAssetParts(assistant)).toEqual([assetPart]);
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
        parts: [
          { type: 'text', text: '继续讲' },
          {
            type: 'asset_ref',
            reference: {
              assetId: 'asset-2',
              versionId: 'version-2',
              kind: 'document',
            },
            usage: 'context',
          },
        ],
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
      retryParts: expect.arrayContaining([
        expect.objectContaining({ type: 'asset_ref' }),
      ]),
    });
  });

  it('只把仅本轮附件写进气泡，笔记本长期来源不留痕', () => {
    /* 长期来源由 Studio 统一管理；若也进气泡，挂 N 个来源问 M 个问题就会
       在屏幕上重复 N×M 次同一份列表。 */
    const initial: InitialChatMessageDTO[] = [
      {
        id: 'student-1',
        turnId: 'turn-1',
        clientMessageId: 'client-1',
        role: 'student',
        status: 'completed',
        content: '看看这张图',
        parts: [
          { type: 'text', text: '看看这张图' },
          {
            type: 'asset_ref',
            reference: {
              assetId: 'notebook-source',
              versionId: 'version-1',
              kind: 'document',
            },
            usage: 'context',
          },
          {
            type: 'asset_ref',
            reference: {
              assetId: 'this-turn-image',
              versionId: 'version-2',
              kind: 'image',
            },
            usage: 'attachment',
          },
        ],
        failureCode: null,
        createdAt: '2026-07-26T00:00:00.000Z',
        completedAt: '2026-07-26T00:00:00.000Z',
      },
    ];

    const [student] = createTeachingTurnState(initial).messages;

    expect(student?.attachments).toEqual([
      { id: 'this-turn-image:version-2', label: '图片附件', kind: 'image' },
    ]);
  });

  it('把本轮Artifact提议附在助手消息末尾且重复事件不复制卡片', () => {
    let state = teachingTurnReducer(createTeachingTurnState([]), {
      type: 'send.started',
      clientMessageId: 'client-artifact',
      text: '生成一张函数思维导图',
    });
    state = teachingTurnReducer(state, {
      type: 'stream.event',
      event: accepted('turn-artifact'),
    });
    const proposed = {
      type: 'artifact.proposed' as const,
      schemaVersion: '1' as const,
      turnId: 'turn-artifact',
      artifactId: 'artifact-1',
      kind: 'mind_map',
      trustTier: 'tier1' as const,
      title: '函数思维导图',
    };
    state = teachingTurnReducer(state, {
      type: 'stream.event',
      event: proposed,
    });
    state = teachingTurnReducer(state, {
      type: 'stream.event',
      event: proposed,
    });

    expect(state.messages.at(-1)).toMatchObject({
      role: 'assistant',
      artifacts: [
        {
          id: 'artifact-1',
          kind: 'mind_map',
          title: '函数思维导图',
          status: 'proposed',
          latestVersion: 0,
        },
      ],
    });

    state = teachingTurnReducer(state, {
      type: 'stream.event',
      event: {
        type: 'artifact.version_added',
        schemaVersion: '1',
        turnId: 'turn-artifact',
        artifactId: 'artifact-1',
        version: 2,
      },
    });
    expect(state.messages.at(-1)).toMatchObject({
      artifacts: [
        expect.objectContaining({
          id: 'artifact-1',
          status: 'active',
          latestVersion: 2,
        }),
      ],
    });

    state = teachingTurnReducer(state, {
      type: 'stream.event',
      event: {
        type: 'artifact.failed',
        schemaVersion: '1',
        turnId: 'turn-artifact',
        artifactId: 'artifact-1',
        code: 'render_failed',
      },
    });
    expect(state.messages.at(-1)).toMatchObject({
      artifacts: [
        expect.objectContaining({ id: 'artifact-1', status: 'failed' }),
      ],
    });
  });
});

describe('工具轨迹', () => {
  function withTurn() {
    let state = teachingTurnReducer(createTeachingTurnState([]), {
      type: 'send.started',
      clientMessageId: 'client-1',
      text: '帮我查一下',
    });
    state = teachingTurnReducer(state, {
      type: 'stream.event',
      event: {
        schemaVersion: '1',
        turnId: 'turn-1',
        type: 'turn.accepted',
        studentMessageId: 'student-1',
        assistantMessageId: 'assistant-1',
        replayed: false,
      },
    });
    return state;
  }

  function started(toolCallId: string, label: string) {
    return {
      type: 'stream.event' as const,
      event: {
        schemaVersion: '1' as const,
        turnId: 'turn-1',
        type: 'tool.started' as const,
        toolCallId,
        label,
      },
    };
  }

  function assistantSteps(state: ReturnType<typeof withTurn>) {
    const message = state.messages.at(-1);
    return message?.role === 'assistant' ? message.toolSteps : undefined;
  }

  function delta(text: string) {
    return {
      type: 'stream.event' as const,
      event: {
        schemaVersion: '1' as const,
        turnId: 'turn-1',
        type: 'message.delta' as const,
        messageId: 'assistant-1',
        delta: text,
      },
    };
  }

  it('并发的多个工具各自留痕，不互相覆盖', () => {
    let state = withTurn();
    state = teachingTurnReducer(state, started('call-1', '正在搜索网页'));
    state = teachingTurnReducer(state, started('call-2', '正在读取网页'));

    expect(assistantSteps(state)).toEqual([
      { id: 'call-1', label: '正在搜索网页', status: 'running' },
      { id: 'call-2', label: '正在读取网页', status: 'running' },
    ]);
  });

  it('完成只改对应条目的状态，痕迹不清空', () => {
    let state = withTurn();
    state = teachingTurnReducer(state, started('call-1', '正在搜索网页'));
    state = teachingTurnReducer(state, started('call-2', '正在读取网页'));
    state = teachingTurnReducer(state, {
      type: 'stream.event',
      event: {
        schemaVersion: '1',
        turnId: 'turn-1',
        type: 'tool.completed',
        toolCallId: 'call-1',
      },
    });

    expect(assistantSteps(state)).toEqual([
      { id: 'call-1', label: '正在搜索网页', status: 'completed' },
      { id: 'call-2', label: '正在读取网页', status: 'running' },
    ]);
  });

  it('缺少 started 的完成事件被忽略，不凭空补一条已完成', () => {
    /* 断连重连可能让 started 丢失；补一条会让界面声称做过没有证据的事。 */
    let state = withTurn();
    state = teachingTurnReducer(state, {
      type: 'stream.event',
      event: {
        schemaVersion: '1',
        turnId: 'turn-1',
        type: 'tool.completed',
        toolCallId: 'ghost',
      },
    });

    expect(assistantSteps(state) ?? []).toEqual([]);
  });

  it('重复的 started 不产生第二条痕迹', () => {
    let state = withTurn();
    state = teachingTurnReducer(state, started('call-1', '正在搜索网页'));
    state = teachingTurnReducer(state, started('call-1', '正在搜索网页'));

    expect(assistantSteps(state)).toHaveLength(1);
  });

  it('工具生命周期不重置 assistant 正文游标，完成后可继续 append 文本', () => {
    let state = withTurn();
    state = teachingTurnReducer(state, delta('先看定义。'));
    state = teachingTurnReducer(state, started('call-1', '正在搜索网页'));

    const assistant = state.messages.at(-1);
    expect(assistant?.role).toBe('assistant');
    expect(assistant?.clientMessageId).toBe('client-1');
    expect(assistant?.text).toBe('先看定义。');

    state = teachingTurnReducer(state, delta('再看例子。'));
    state = teachingTurnReducer(state, {
      type: 'stream.event',
      event: {
        schemaVersion: '1',
        turnId: 'turn-1',
        type: 'tool.completed',
        toolCallId: 'call-1',
      },
    });
    state = teachingTurnReducer(state, delta('最后一段。'));

    const final = state.messages.at(-1);
    expect(final).toMatchObject({
      role: 'assistant',
      clientMessageId: 'client-1',
      text: '先看定义。再看例子。最后一段。',
      status: 'streaming',
    });
    expect(assistantSteps(state)).toEqual([
      { id: 'call-1', label: '正在搜索网页', status: 'completed' },
    ]);
  });
});
