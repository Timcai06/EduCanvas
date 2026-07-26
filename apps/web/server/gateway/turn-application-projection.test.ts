import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
import {
  turnApplicationProtocolVersion,
  type TurnApplicationEvent,
} from '@educanvas/agent-core';
import {
  gatewayProtocolVersion,
  type GatewayOperationEvent,
} from '@educanvas/gateway-core';
import { projectTurnApplicationEventToGateway } from '@educanvas/gateway-runtime';
import type { TeachingTurnEvent } from '@/features/chat/turn-events';
import {
  gatewayToLegacy,
  projectTurnApplicationEventToWeb,
} from './turn-application-projection';

const operationId = 'operation:golden';
const occurredAt = '2026-07-21T08:00:00.000Z';
const base = { protocol: turnApplicationProtocolVersion, operationId } as const;
const started: TurnApplicationEvent = {
  ...base,
  type: 'turn.started',
  userMessageId: 'message:user:1',
  assistantMessageId: 'message:assistant:1',
  replayed: false,
};

async function* eventsOf<T>(events: readonly T[]): AsyncGenerator<T> {
  yield* events;
}

async function collect<T>(events: AsyncIterable<T>): Promise<T[]> {
  const collected: T[] = [];
  for await (const event of events) collected.push(event);
  return collected;
}

async function expectParity(script: readonly TurnApplicationEvent[]) {
  const web = script
    .map((event) => projectTurnApplicationEventToWeb(event))
    .filter((event): event is TeachingTurnEvent => event !== null);
  const gateway = script.map((event, sequence) => {
    const payload = projectTurnApplicationEventToGateway(event, {
      actorUserId: 'user:1',
      occurredAt,
    });
    return {
      protocol: gatewayProtocolVersion,
      eventId: `event:${sequence}`,
      operationId,
      sequence,
      occurredAt,
      ...payload,
    } as GatewayOperationEvent;
  });
  expect(await collect(gatewayToLegacy(eventsOf(gateway)))).toEqual(web);
}

describe('Turn Application Web/Gateway golden parity', () => {
  it('keeps text, citation, tool and completed semantics equivalent', async () => {
    await expectParity([
      started,
      {
        ...base,
        type: 'message.delta',
        messageId: 'message:assistant:1',
        delta: '勾股定理：',
      },
      {
        ...base,
        type: 'message.citation',
        messageId: 'message:assistant:1',
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
      {
        ...base,
        type: 'tool.started',
        toolCallId: 'tool-call:1',
        tool: 'web.search',
      },
      {
        ...base,
        type: 'tool.completed',
        toolCallId: 'tool-call:1',
        summary: '检索完成',
      },
      {
        ...base,
        type: 'turn.completed',
        messageId: 'message:assistant:1',
      },
    ]);
  });

  it('keeps failed and cancelled unique terminal semantics equivalent', async () => {
    await expectParity([
      started,
      {
        ...base,
        type: 'turn.failed',
        messageId: 'message:assistant:1',
        code: 'MODEL_FAILED',
        retryable: true,
      },
    ]);
    await expectParity([
      started,
      {
        ...base,
        type: 'turn.cancelled',
        messageId: 'message:assistant:1',
      },
    ]);
  });
});

describe('工具动作名投影', () => {
  const base = {
    protocol: 'educanvas.turn.v2' as const,
    operationId: 'operation:1',
  };

  function label(tool: string): string | undefined {
    const projected = projectTurnApplicationEventToWeb({
      ...base,
      type: 'tool.started',
      toolCallId: 'tool-call:1',
      tool,
    });
    return projected?.type === 'tool.started' ? projected.label : undefined;
  }

  it('把能力标识映射为学生可读的动作名', () => {
    expect(label('web.search')).toBe('正在搜索网页');
    expect(label('artifact.create')).toBe('正在准备学习材料');
    expect(label('agent.plan_note')).toBe('正在梳理思路');
  });

  it('未知工具兜底为通用文案，绝不把内部标识透给学生', () => {
    /* 界面零技术术语（docs/01-product/student-ui-spec.md）：新增工具忘了加
       映射时，学生应看到「正在使用工具」而不是 filesystem.read_allowlisted。 */
    expect(label('some.unmapped_capability')).toBe('正在使用工具');
  });
});
