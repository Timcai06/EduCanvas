/**
 * turn-application-projection 测试共享最小 helper。
 *
 * 只提供构造与收集工具，不包含任何断言或私有实现复制：
 * - makeGatewayEvent：拼装带协议 base 的 GatewayOperationEvent（sequence 自增 eventId）
 * - eventsOf / collect：AsyncIterable 测试夹具
 */

import {
  gatewayProtocolVersion,
  type GatewayOperationEvent,
} from '@educanvas/gateway-core';
import type { GatewayEventPayload } from '@educanvas/gateway-runtime';

export const gatewayFixtureBase = {
  protocol: gatewayProtocolVersion,
  operationId: 'operation:1',
  occurredAt: '2026-07-21T08:00:00.000Z',
} as const;

export function makeGatewayEvent(
  sequence: number,
  payload: GatewayEventPayload,
  operationId: string = gatewayFixtureBase.operationId,
): GatewayOperationEvent {
  return {
    ...gatewayFixtureBase,
    operationId,
    eventId: `event:${sequence}`,
    sequence,
    ...payload,
  } as GatewayOperationEvent;
}

export async function* eventsOf<T>(events: readonly T[]): AsyncGenerator<T> {
  yield* events;
}

export async function collect<T>(events: AsyncIterable<T>): Promise<T[]> {
  const collected: T[] = [];
  for await (const event of events) collected.push(event);
  return collected;
}
