import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
import { type GatewayOperationEvent } from '@educanvas/gateway-core';
import { gatewayCrossEntryConformance } from '../../../../tooling/test-fixtures/gateway-cross-entry-conformance';
import { gatewayToLegacy } from './turn-application-projection';

async function project(events: readonly GatewayOperationEvent[]) {
  async function* source() {
    yield* events;
  }
  const projected = [];
  for await (const event of gatewayToLegacy(source())) projected.push(event);
  return projected;
}

describe('Web SSE跨入口合规', () => {
  it('投影完成流且只保留一个终态', async () => {
    const events = await project(gatewayCrossEntryConformance.completed);
    expect(events.map((event) => event.type)).toEqual([
      'turn.accepted',
      'message.delta',
      'turn.completed',
    ]);
  });

  it('审批留在独立控制面且不伪装完成或失败', async () => {
    const events = await project(gatewayCrossEntryConformance.approvalPending);
    expect(events.map((event) => event.type)).toEqual([
      'turn.accepted',
      'message.delta',
    ]);
  });

  it('取消使用唯一终态且不虚构steer事件', async () => {
    const events = await project(gatewayCrossEntryConformance.cancelled);
    expect(events.map((event) => event.type)).toEqual([
      'turn.accepted',
      'message.delta',
      'turn.cancelled',
    ]);
    expect(events.some((event) => event.type.includes('steer'))).toBe(false);
  });

  it('对入口能力差异诚实返回不可用', async () => {
    const events = await project(
      gatewayCrossEntryConformance.capabilityUnavailable,
    );
    expect(events).toEqual([
      {
        schemaVersion: '1',
        turnId: 'operation:cross-entry',
        type: 'turn.failed',
        messageId: 'operation:cross-entry',
        code: 'CAPABILITY_UNAVAILABLE',
        message: '当前能力暂时不可用。',
        retryable: false,
      },
    ]);
  });
});
