import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
import type { GatewayOperationEvent } from '@educanvas/gateway-core';
import type { TeachingTurnEvent } from '@/features/chat/turn-events';
import { gatewayToLegacy } from './turn-application-projection';
import {
  collect,
  eventsOf,
  makeGatewayEvent,
} from './turn-application-projection-test-helpers';

describe('gatewayToLegacy canonical→legacy 表驱动映射', () => {
  const cases: ReadonlyArray<{
    name: string;
    event: GatewayOperationEvent;
    expected: TeachingTurnEvent[];
  }> = [
    {
      name: 'operation.accepted 不产出 legacy 事件',
      event: makeGatewayEvent(0, { type: 'operation.accepted' }),
      expected: [],
    },
    {
      name: 'message.started → turn.accepted',
      event: makeGatewayEvent(0, {
        type: 'message.started',
        userMessageId: 'message:user:1',
        assistantMessageId: 'message:assistant:1',
        replayed: false,
      }),
      expected: [
        {
          schemaVersion: '1',
          turnId: 'operation:1',
          type: 'turn.accepted',
          studentMessageId: 'message:user:1',
          assistantMessageId: 'message:assistant:1',
          replayed: false,
        },
      ],
    },
    {
      name: 'message.citation(web) → message.citation',
      event: makeGatewayEvent(0, {
        type: 'message.citation',
        messageId: 'message:assistant:1',
        citation: {
          citationId: 'citation:1',
          marker: 1,
          label: '公开资料',
          target: {
            kind: 'web',
            assetId: 'asset:1',
            assetVersionId: 'asset-version:1',
            url: 'https://example.com/math',
          },
        },
      }),
      expected: [
        {
          schemaVersion: '1',
          turnId: 'operation:1',
          type: 'message.citation',
          messageId: 'message:assistant:1',
          citationId: 'citation:1',
          marker: 1,
          label: '公开资料',
          pageStart: null,
          pageEnd: null,
          kind: 'web',
          assetId: 'asset:1',
          assetVersionId: 'asset-version:1',
          url: 'https://example.com/math',
        },
      ],
    },
    {
      name: 'message.citation(knowledge) → message.citation',
      event: makeGatewayEvent(0, {
        type: 'message.citation',
        messageId: 'message:assistant:1',
        citation: {
          citationId: 'citation:2',
          label: '教材',
          target: {
            kind: 'knowledge',
            sourceId: 'source:1',
            documentId: 'doc:1',
            chunkId: 'chunk:1',
            pageStart: 3,
            pageEnd: 5,
          },
        },
      }),
      expected: [
        {
          schemaVersion: '1',
          turnId: 'operation:1',
          type: 'message.citation',
          messageId: 'message:assistant:1',
          citationId: 'citation:2',
          label: '教材',
          pageStart: 3,
          pageEnd: 5,
          kind: 'knowledge',
          sourceId: 'source:1',
          documentId: 'doc:1',
          chunkId: 'chunk:1',
        },
      ],
    },
    {
      name: 'tool.started 从稳定 tool ID 投影动作名',
      event: makeGatewayEvent(0, {
        type: 'tool.started',
        toolCallId: 'tool-call:1',
        tool: 'web.search',
      }),
      expected: [
        {
          schemaVersion: '1',
          turnId: 'operation:1',
          type: 'tool.started',
          toolCallId: 'tool-call:1',
          label: '正在搜索网页',
          activity: 'web_search',
        },
      ],
    },
    {
      name: 'tool.completed → tool.completed',
      event: makeGatewayEvent(0, {
        type: 'tool.completed',
        toolCallId: 'tool-call:1',
        summary: { label: '检索完成' },
      }),
      expected: [
        {
          schemaVersion: '1',
          turnId: 'operation:1',
          type: 'tool.completed',
          toolCallId: 'tool-call:1',
        },
      ],
    },
    {
      name: 'tool.failed 保真透传 code',
      event: makeGatewayEvent(0, {
        type: 'tool.failed',
        toolCallId: 'tool-call:1',
        code: 'RUNTIME_FAILED',
        retryable: true,
      }),
      expected: [
        {
          schemaVersion: '1',
          turnId: 'operation:1',
          type: 'tool.failed',
          toolCallId: 'tool-call:1',
          code: 'RUNTIME_FAILED',
        },
      ],
    },
    {
      name: 'artifact.proposed → artifact.proposed（trustTier 兜底 tier1）',
      event: makeGatewayEvent(0, {
        type: 'artifact.proposed',
        artifactId: 'artifact:1',
        artifactKind: 'canvas',
        title: '勾股定理演示',
      }),
      expected: [
        {
          schemaVersion: '1',
          turnId: 'operation:1',
          type: 'artifact.proposed',
          artifactId: 'artifact:1',
          kind: 'canvas',
          trustTier: 'tier1',
          title: '勾股定理演示',
        },
      ],
    },
    {
      name: 'artifact.version_added → artifact.version_added（版本号解析）',
      event: makeGatewayEvent(0, {
        type: 'artifact.version_added',
        artifactId: 'artifact:1',
        versionId: '3',
      }),
      expected: [
        {
          schemaVersion: '1',
          turnId: 'operation:1',
          type: 'artifact.version_added',
          artifactId: 'artifact:1',
          version: 3,
        },
      ],
    },
    {
      name: 'artifact.generation_progress → artifact.generation_progress',
      event: makeGatewayEvent(0, {
        type: 'artifact.generation_progress',
        artifactId: 'artifact:1',
        jobId: 'job:1',
        progress: 0.5,
      }),
      expected: [
        {
          schemaVersion: '1',
          turnId: 'operation:1',
          type: 'artifact.generation_progress',
          artifactId: 'artifact:1',
          jobId: 'job:1',
          progress: 0.5,
        },
      ],
    },
    {
      name: 'artifact.failed 保真透传 code（jobId 有值）',
      event: makeGatewayEvent(0, {
        type: 'artifact.failed',
        artifactId: 'artifact:1',
        jobId: 'job:1',
        code: 'RUNTIME_FAILED',
      }),
      expected: [
        {
          schemaVersion: '1',
          turnId: 'operation:1',
          type: 'artifact.failed',
          artifactId: 'artifact:1',
          jobId: 'job:1',
          code: 'RUNTIME_FAILED',
        },
      ],
    },
    {
      name: 'artifact.failed jobId 为 null 时省略该字段',
      event: makeGatewayEvent(0, {
        type: 'artifact.failed',
        artifactId: 'artifact:1',
        jobId: null,
        code: 'RUNTIME_FAILED',
      }),
      expected: [
        {
          schemaVersion: '1',
          turnId: 'operation:1',
          type: 'artifact.failed',
          artifactId: 'artifact:1',
          code: 'RUNTIME_FAILED',
        },
      ],
    },
    {
      name: 'operation.completed → turn.completed',
      event: makeGatewayEvent(0, {
        type: 'operation.completed',
        messageId: 'message:assistant:1',
      }),
      expected: [
        {
          schemaVersion: '1',
          turnId: 'operation:1',
          type: 'turn.completed',
          messageId: 'message:assistant:1',
        },
      ],
    },
    {
      name: 'operation.failed → turn.failed（code/retryable 保真，message 按 audience）',
      event: makeGatewayEvent(0, {
        type: 'operation.failed',
        code: 'RATE_LIMITED',
        retryable: false,
      }),
      expected: [
        {
          schemaVersion: '1',
          turnId: 'operation:1',
          type: 'turn.failed',
          messageId: 'operation:1',
          code: 'RATE_LIMITED',
          message: '请求较多，请稍后重试。',
          retryable: false,
        },
      ],
    },
    {
      name: 'operation.cancelled → turn.cancelled（无 started 时 messageId 用 operationId）',
      event: makeGatewayEvent(0, { type: 'operation.cancelled' }),
      expected: [
        {
          schemaVersion: '1',
          turnId: 'operation:1',
          type: 'turn.cancelled',
          messageId: 'operation:1',
        },
      ],
    },
    {
      name: 'approval.required 不进入 legacy 聊天流',
      event: makeGatewayEvent(0, {
        type: 'approval.required',
        approval: {
          approvalId: 'approval:1',
          operationId: 'operation:1',
          actorUserId: 'user:1',
          capability: 'approval.interactive',
          risk: 'l2',
          summary: '允许本次受控操作',
          requestedAt: '2026-07-21T08:00:00.000Z',
          expiresAt: '2026-07-21T08:05:00.000Z',
        },
      }),
      expected: [],
    },
  ];

  it.each(cases)('$name', async ({ event, expected }) => {
    const projected = await collect(gatewayToLegacy(eventsOf([event])));
    expect(projected).toEqual(
      expected.map((item) => ({ ...item, sequence: event.sequence })),
    );
  });
});
