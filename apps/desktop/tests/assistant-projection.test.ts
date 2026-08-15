import { describe, expect, it } from 'vitest';
import type { GatewayOperationEvent } from '@educanvas/gateway-core';
import { toAssistantProjection } from '../src/main/assistant-projection';
import { applyAssistantProjection } from '../src/renderer/src/assistant-stream';
import { desktopStreamKey } from '../src/shared/assistant-projection';
import type { DesktopChatHistorySnapshot } from '../src/shared/chat-history';

const CONTEXT = {
  requestId: 'request:one',
  clientMessageId: 'desktop:abc',
  conversationId: 'conversation:one',
};

function event(
  sequence: number,
  value: Record<string, unknown>,
): GatewayOperationEvent {
  return {
    protocol: 'gateway.v1',
    eventId: `event:${sequence}`,
    operationId: 'operation:one',
    sequence,
    occurredAt: '2026-08-11T08:00:00.000Z',
    ...value,
  } as GatewayOperationEvent;
}

describe('toAssistantProjection', () => {
  it('projects accepted with request identity and conversation', () => {
    expect(
      toAssistantProjection(event(0, { type: 'operation.accepted' }), CONTEXT),
    ).toEqual({
      type: 'accepted',
      requestId: 'request:one',
      clientMessageId: 'desktop:abc',
      conversationId: 'conversation:one',
      operationId: 'operation:one',
    });
  });

  it('projects message.started with the assistant message id', () => {
    const projection = toAssistantProjection(
      event(1, {
        type: 'message.started',
        userMessageId: 'message:user',
        assistantMessageId: 'message:assistant',
        replayed: false,
      }),
      CONTEXT,
    );
    expect(projection).toMatchObject({
      type: 'message.started',
      assistantMessageId: 'message:assistant',
    });
  });

  it('projects deltas without exposing raw operation internals', () => {
    const projection = toAssistantProjection(
      event(2, { type: 'message.delta', delta: '你好，' }),
      CONTEXT,
    );
    expect(projection).toEqual({
      type: 'delta',
      requestId: 'request:one',
      clientMessageId: 'desktop:abc',
      conversationId: 'conversation:one',
      operationId: 'operation:one',
      sequence: 2,
      delta: '你好，',
    });
  });

  it('projects tool lifecycle as a stable status summary', () => {
    expect(
      toAssistantProjection(
        event(3, { type: 'tool.started', toolCallId: 't:1', tool: 'search' }),
        CONTEXT,
      ),
    ).toMatchObject({ type: 'tool', tool: 'search', status: 'started' });
    expect(
      toAssistantProjection(
        event(4, {
          type: 'tool.completed',
          toolCallId: 't:1',
          summary: { ok: true },
        }),
        CONTEXT,
      ),
    ).toMatchObject({ type: 'tool', status: 'completed' });
    expect(
      toAssistantProjection(
        event(5, {
          type: 'tool.failed',
          toolCallId: 't:1',
          code: 'RUNTIME_FAILED',
          retryable: true,
        }),
        CONTEXT,
      ),
    ).toMatchObject({ type: 'tool', status: 'failed' });
  });

  it('projects terminal states with a stable user-facing message', () => {
    expect(
      toAssistantProjection(
        event(6, { type: 'operation.completed', messageId: 'message:one' }),
        CONTEXT,
      ),
    ).toMatchObject({ type: 'final', status: 'completed' });
    expect(
      toAssistantProjection(
        event(7, {
          type: 'operation.failed',
          code: 'RUNTIME_FAILED',
          retryable: true,
        }),
        CONTEXT,
      ),
    ).toMatchObject({ type: 'final', status: 'failed' });
    expect(
      toAssistantProjection(event(8, { type: 'operation.cancelled' }), CONTEXT),
    ).toMatchObject({ type: 'final', status: 'aborted' });
  });

  it('projects citation with structured resource identity', () => {
    expect(
      toAssistantProjection(
        event(9, {
          type: 'message.citation',
          messageId: 'message:assistant',
          citation: {
            citationId: 'citation:1',
            marker: 1,
            label: '来源',
            target: {
              kind: 'web',
              assetId: 'asset:1',
              assetVersionId: 'version:1',
              url: 'https://example.com/1',
            },
          },
        }),
        CONTEXT,
      ),
    ).toMatchObject({
      type: 'citation',
      sequence: 9,
      citation: {
        citationId: 'citation:1',
        marker: 1,
        label: '来源',
        target: {
          kind: 'web',
          assetId: 'asset:1',
          assetVersionId: 'version:1',
          url: 'https://example.com/1',
        },
      },
    });
  });

  it('projects artifact lifecycle and merges identity across phases', () => {
    expect(
      toAssistantProjection(
        event(10, {
          type: 'artifact.proposed',
          artifactId: 'artifact:1',
          artifactKind: 'mindmap',
          title: '知识导图',
        }),
        CONTEXT,
      ),
    ).toMatchObject({
      type: 'artifact',
      artifact: {
        artifactId: 'artifact:1',
        artifactKind: 'mindmap',
        title: '知识导图',
        status: 'proposed',
      },
    });
    expect(
      toAssistantProjection(
        event(11, {
          type: 'artifact.generation_progress',
          artifactId: 'artifact:1',
          jobId: 'job:1',
          progress: 0.5,
        }),
        CONTEXT,
      ),
    ).toMatchObject({
      type: 'artifact',
      artifact: {
        artifactId: 'artifact:1',
        status: 'generating',
        progress: 0.5,
      },
    });
    expect(
      toAssistantProjection(
        event(12, {
          type: 'artifact.failed',
          artifactId: 'artifact:1',
          jobId: null,
          code: 'RUNTIME_FAILED',
        }),
        CONTEXT,
      ),
    ).toMatchObject({
      type: 'artifact',
      artifact: {
        artifactId: 'artifact:1',
        status: 'failed',
        code: 'RUNTIME_FAILED',
      },
    });
  });

  it('projects approval.required and approval.resolved without losing the approval id', () => {
    expect(
      toAssistantProjection(
        event(13, {
          type: 'approval.required',
          approval: {
            approvalId: 'approval:1',
            operationId: 'operation:one',
            actorUserId: 'user:1',
            capability: 'external.mcp.invoke',
            risk: 'l2',
            summary: '调用外部服务',
            requestedAt: '2026-08-11T08:00:00.000Z',
            expiresAt: '2026-08-11T08:05:00.000Z',
          },
        }),
        CONTEXT,
      ),
    ).toMatchObject({
      type: 'approval',
      approvalId: 'approval:1',
      status: 'required',
      approval: {
        approvalId: 'approval:1',
        operationId: 'operation:one',
        capability: 'external.mcp.invoke',
        risk: 'l2',
        summary: '调用外部服务',
        expiresAt: '2026-08-11T08:05:00.000Z',
      },
    });
    expect(
      toAssistantProjection(
        event(14, {
          type: 'approval.resolved',
          decision: {
            approvalId: 'approval:1',
            status: 'approved',
            decidedByUserId: 'user:1',
            decidedAt: '2026-08-11T08:03:00.000Z',
          },
        }),
        CONTEXT,
      ),
    ).toEqual({
      type: 'approval',
      requestId: 'request:one',
      clientMessageId: 'desktop:abc',
      conversationId: 'conversation:one',
      operationId: 'operation:one',
      approvalId: 'approval:1',
      status: 'resolved',
      approval: null,
    });
  });

  it('preserves stable gateway failure codes on final', () => {
    expect(
      toAssistantProjection(
        event(15, {
          type: 'operation.failed',
          code: 'CAPABILITY_UNAVAILABLE',
          retryable: false,
        }),
        CONTEXT,
      ),
    ).toMatchObject({
      type: 'final',
      status: 'failed',
      code: 'CAPABILITY_UNAVAILABLE',
    });
    expect(
      toAssistantProjection(
        event(16, { type: 'operation.cancelled' }),
        CONTEXT,
      ),
    ).toMatchObject({ type: 'final', status: 'aborted', code: 'CANCELLED' });
    expect(
      toAssistantProjection(
        event(17, { type: 'operation.completed', messageId: 'm:1' }),
        CONTEXT,
      ),
    ).toMatchObject({ type: 'final', status: 'completed', code: null });
  });
});

describe('applyAssistantProjection', () => {
  const baseSnapshot: DesktopChatHistorySnapshot = {
    revision: 1,
    conversationId: 'conversation:one',
    messages: [
      {
        id: 'user:one',
        clientMessageId: 'desktop:abc',
        role: 'user',
        content: '你好',
        source: 'text',
        status: 'completed',
        createdAt: '2026-08-11T08:00:00.000Z',
      },
    ],
    hasMore: false,
    nextCursor: null,
    loading: false,
  };
  const started = (): DesktopChatHistorySnapshot => {
    const next = applyAssistantProjection(baseSnapshot, {
      type: 'message.started',
      ...CONTEXT,
      operationId: 'operation:one',
      assistantMessageId: 'message:assistant',
    });
    return next ?? baseSnapshot;
  };

  it('drops events from another conversation (stale operation guard)', () => {
    const stale = applyAssistantProjection(baseSnapshot, {
      type: 'delta',
      ...CONTEXT,
      conversationId: 'conversation:other',
      operationId: 'operation:old',
      sequence: 1,
      delta: '迟到',
    });
    expect(stale).toBeNull();
  });

  it('ignores accepted and tool events for the message list', () => {
    expect(
      applyAssistantProjection(baseSnapshot, {
        type: 'accepted',
        ...CONTEXT,
        operationId: 'operation:one',
      }),
    ).toBeNull();
    expect(
      applyAssistantProjection(baseSnapshot, {
        type: 'tool',
        ...CONTEXT,
        operationId: 'operation:one',
        tool: 'search',
        status: 'started',
      }),
    ).toBeNull();
  });

  it('creates a streaming placeholder on message.started and appends deltas in place', () => {
    const startedSnapshot = started();
    expect(startedSnapshot.messages.at(-1)).toMatchObject({
      id: 'streaming:desktop:abc',
      role: 'assistant',
      content: '',
      status: 'streaming',
    });

    const deltaSnapshot = applyAssistantProjection(startedSnapshot, {
      type: 'delta',
      ...CONTEXT,
      operationId: 'operation:one',
      sequence: 2,
      delta: '你好，',
    });
    const afterDelta = applyAssistantProjection(
      deltaSnapshot ?? startedSnapshot,
      {
        type: 'delta',
        ...CONTEXT,
        operationId: 'operation:one',
        sequence: 3,
        delta: '我是老师。',
      },
    );
    expect(afterDelta?.messages.at(-1)?.content).toBe('你好，我是老师。');
    // 占位不重复创建，用户消息不被移动
    expect(afterDelta?.messages).toHaveLength(2);
  });

  it('appends deltas directly when no message.started arrived yet', () => {
    const next = applyAssistantProjection(baseSnapshot, {
      type: 'delta',
      ...CONTEXT,
      operationId: 'operation:one',
      sequence: 2,
      delta: '直接增量',
    });
    expect(next?.messages.at(-1)).toMatchObject({
      content: '直接增量',
      status: 'streaming',
    });
  });

  it('marks the placeholder terminal on final and leaves content intact', () => {
    const next = applyAssistantProjection(started(), {
      type: 'final',
      ...CONTEXT,
      operationId: 'operation:one',
      status: 'completed',
      message: '完成。',
      code: null,
    });
    expect(next?.messages.at(-1)).toMatchObject({
      status: 'completed',
      content: '',
    });
  });

  it('maps failed/interrupted/aborted finals to terminal view statuses', () => {
    const interrupted = applyAssistantProjection(started(), {
      type: 'final',
      ...CONTEXT,
      operationId: 'operation:one',
      status: 'interrupted',
      message: '中断',
      code: null,
    });
    expect(interrupted?.messages.at(-1)?.status).toBe('interrupted');
    const cancelled = applyAssistantProjection(started(), {
      type: 'final',
      ...CONTEXT,
      operationId: 'operation:one',
      status: 'aborted',
      message: '已取消',
      code: 'CANCELLED',
    });
    expect(cancelled?.messages.at(-1)?.status).toBe('cancelled');
  });

  it('ignores a final for a placeholder it never created', () => {
    const stale = applyAssistantProjection(baseSnapshot, {
      type: 'final',
      ...CONTEXT,
      operationId: 'operation:one',
      status: 'completed',
      message: '完成。',
      code: null,
    });
    expect(stale).toBeNull();
  });

  it('retains citations, artifacts and pending approval on the streaming message', () => {
    let snapshot = started();
    snapshot =
      applyAssistantProjection(snapshot, {
        type: 'citation',
        ...CONTEXT,
        operationId: 'operation:one',
        sequence: 9,
        citation: {
          citationId: 'citation:1',
          marker: 1,
          label: '来源',
          target: {
            kind: 'web',
            assetId: 'asset:1',
            assetVersionId: 'version:1',
            url: 'https://example.com/1',
          },
        },
      }) ?? snapshot;
    snapshot =
      applyAssistantProjection(snapshot, {
        type: 'artifact',
        ...CONTEXT,
        operationId: 'operation:one',
        artifact: {
          artifactId: 'artifact:1',
          artifactKind: 'mindmap',
          title: '知识导图',
          status: 'proposed',
        },
      }) ?? snapshot;
    // version_added 不带 kind/title，合并后应保留 proposed 阶段的身份。
    snapshot =
      applyAssistantProjection(snapshot, {
        type: 'artifact',
        ...CONTEXT,
        operationId: 'operation:one',
        artifact: {
          artifactId: 'artifact:1',
          artifactKind: null,
          title: null,
          status: 'version_added',
          versionId: 'version:1',
        },
      }) ?? snapshot;
    snapshot =
      applyAssistantProjection(snapshot, {
        type: 'approval',
        ...CONTEXT,
        operationId: 'operation:one',
        approvalId: 'approval:1',
        status: 'required',
        approval: {
          approvalId: 'approval:1',
          operationId: 'operation:one',
          capability: 'external.mcp.invoke',
          risk: 'l2',
          summary: '调用外部服务',
          expiresAt: '2026-08-11T08:05:00.000Z',
        },
      }) ?? snapshot;
    const message = snapshot.messages.at(-1)!;
    expect(message.citations).toHaveLength(1);
    expect(message.artifacts).toEqual([
      {
        artifactId: 'artifact:1',
        artifactKind: 'mindmap',
        title: '知识导图',
        status: 'version_added',
        versionId: 'version:1',
      },
    ]);
    expect(message.pendingApproval?.approvalId).toBe('approval:1');
  });

  it('clears the pending approval only for the matching approval id', () => {
    let snapshot = started();
    snapshot =
      applyAssistantProjection(snapshot, {
        type: 'approval',
        ...CONTEXT,
        operationId: 'operation:one',
        approvalId: 'approval:1',
        status: 'required',
        approval: {
          approvalId: 'approval:1',
          operationId: 'operation:one',
          capability: 'external.mcp.invoke',
          risk: 'l2',
          summary: '调用外部服务',
          expiresAt: '2026-08-11T08:05:00.000Z',
        },
      }) ?? snapshot;
    const mismatched = applyAssistantProjection(snapshot, {
      type: 'approval',
      ...CONTEXT,
      operationId: 'operation:one',
      approvalId: 'approval:2',
      status: 'resolved',
      approval: null,
    });
    expect(mismatched?.messages.at(-1)?.pendingApproval?.approvalId).toBe(
      'approval:1',
    );
    const matched = applyAssistantProjection(snapshot, {
      type: 'approval',
      ...CONTEXT,
      operationId: 'operation:one',
      approvalId: 'approval:1',
      status: 'resolved',
      approval: null,
    });
    expect(matched?.messages.at(-1)?.pendingApproval).toBeNull();
  });
});

describe('desktopStreamKey', () => {
  it('prefers clientMessageId and falls back to the request identity', () => {
    expect(
      desktopStreamKey({
        clientMessageId: 'desktop:abc',
        requestId: 'request:one',
      }),
    ).toBe('desktop:abc');
    expect(
      desktopStreamKey({ clientMessageId: null, requestId: 'request:one' }),
    ).toBe('request:request:one');
  });
});
