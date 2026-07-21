import { describe, expect, it } from 'vitest';
import {
  turnApplicationProtocolVersion,
  type TurnApplicationEvent,
} from '@educanvas/agent-core';
import {
  gatewayOperationEventSchema,
  gatewayProtocolVersion,
} from '@educanvas/gateway-core';
import {
  projectTurnApplicationEventToGateway,
  toGatewayFailureCode,
} from './turn-application-projection';

const context = {
  actorUserId: 'user:1',
  occurredAt: '2026-07-21T08:00:00.000Z',
};

describe('Turn Application Gateway projection', () => {
  it('maps terminal failures without leaking provider-specific codes', () => {
    expect(toGatewayFailureCode('MODEL_FAILED')).toBe('RUNTIME_FAILED');
    expect(toGatewayFailureCode('TOOL_FAILED')).toBe('RUNTIME_FAILED');
    expect(toGatewayFailureCode('RATE_LIMITED')).toBe('RATE_LIMITED');
  });

  it('builds approvals only from supported L2/L3 Gateway capabilities', () => {
    const approval: TurnApplicationEvent = {
      protocol: turnApplicationProtocolVersion,
      operationId: 'operation:1',
      type: 'approval.required',
      approvalId: 'approval:1',
      capability: 'approval.interactive',
      risk: 'l2',
      summary: '允许本次受控操作',
      expiresAt: '2026-07-21T08:05:00.000Z',
    };
    expect(projectTurnApplicationEventToGateway(approval, context)).toEqual({
      type: 'approval.required',
      approval: {
        approvalId: 'approval:1',
        operationId: 'operation:1',
        actorUserId: 'user:1',
        capability: 'approval.interactive',
        risk: 'l2',
        summary: '允许本次受控操作',
        requestedAt: context.occurredAt,
        expiresAt: approval.expiresAt,
      },
    });

    expect(() =>
      projectTurnApplicationEventToGateway(
        { ...approval, capability: 'unknown.write' },
        context,
      ),
    ).toThrow();
    expect(() =>
      projectTurnApplicationEventToGateway(
        { ...approval, risk: 'l1' },
        context,
      ),
    ).toThrow('gateway_approval_requires_l2_or_l3');
  });

  it('produces a Gateway payload accepted by the public event contract', () => {
    const payload = projectTurnApplicationEventToGateway(
      {
        protocol: turnApplicationProtocolVersion,
        operationId: 'operation:1',
        type: 'turn.completed',
        messageId: 'message:assistant:1',
      },
      context,
    );
    expect(
      gatewayOperationEventSchema.parse({
        protocol: gatewayProtocolVersion,
        eventId: 'event:1',
        operationId: 'operation:1',
        sequence: 1,
        occurredAt: context.occurredAt,
        ...payload,
      }),
    ).toMatchObject({
      type: 'operation.completed',
      messageId: 'message:assistant:1',
    });
  });
});
