import { describe, expect, it } from 'vitest';
import { gatewayCrossEntryConformance } from '../../../tooling/test-fixtures/gateway-cross-entry-conformance';
import {
  gatewayOperationEventSchema,
  isGatewayTerminalEvent,
  validateGatewayEventSequence,
} from './events';

describe('Gateway跨入口合规夹具', () => {
  it.each([
    'completed',
    'approvalPending',
    'cancelled',
    'capabilityUnavailable',
  ] as const)('%s保持严格Schema、顺序与唯一终态', (name) => {
    const events = gatewayCrossEntryConformance[name];
    expect(
      events.map((event) => gatewayOperationEventSchema.parse(event)),
    ).toHaveLength(events.length);
    expect(validateGatewayEventSequence(events)).toBe(true);
    expect(events.filter(isGatewayTerminalEvent)).toHaveLength(
      name === 'approvalPending' ? 0 : 1,
    );
  });

  it('公共请求与可信路由指向同一Notebook且Profile只来自服务端', () => {
    expect(gatewayCrossEntryConformance.request.notebookId).toBe(
      gatewayCrossEntryConformance.resolvedRoute.notebookId,
    );
    expect(gatewayCrossEntryConformance.request.conversationId).toBe(
      gatewayCrossEntryConformance.resolvedRoute.conversationId,
    );
    expect(gatewayCrossEntryConformance.request).not.toHaveProperty(
      'agentProfileId',
    );
    expect(gatewayCrossEntryConformance.request).not.toHaveProperty(
      'principal',
    );
  });
});
