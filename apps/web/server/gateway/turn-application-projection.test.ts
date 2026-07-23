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
