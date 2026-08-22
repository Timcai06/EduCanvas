import { describe, expect, it } from 'vitest';
import { gatewayCrossEntryConformance } from '../../../tooling/testing/fixtures/gateway-cross-entry-conformance';
import {
  gatewayOperationEventSchema,
  isGatewayTerminalEvent,
  validateGatewayEventSequence,
} from './events';

describe('Gateway跨入口合规夹具', () => {
  it.each([
    'completed',
    'toolCompleted',
    'toolFailed',
    'approvalPending',
    'cancelled',
    'capabilityUnavailable',
    'runtimeFailed',
    'internalFailure',
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

  it('拒绝未知事件和终态后的任何追加事件', () => {
    const firstEvent = gatewayCrossEntryConformance.completed[0];
    const terminalEvent = gatewayCrossEntryConformance.completed.at(-1);
    if (!firstEvent || !terminalEvent) {
      throw new Error('cross-entry completed fixture must not be empty');
    }

    expect(
      gatewayOperationEventSchema.safeParse({
        ...firstEvent,
        type: 'operation.future_terminal',
      }).success,
    ).toBe(false);
    expect(
      validateGatewayEventSequence([
        ...gatewayCrossEntryConformance.completed,
        {
          ...terminalEvent,
          sequence: 4,
          eventId: 'event:cross-entry:4',
        },
      ]),
    ).toBe(false);
  });

  it.each(['message', 'stack', 'providerBody', 'prompt'])(
    'operation.failed拒绝公共协议中的私有字段%s',
    (field) => {
      const failed = gatewayCrossEntryConformance.internalFailure.at(-1);
      if (!failed)
        throw new Error('internal failure fixture must not be empty');
      expect(
        gatewayOperationEventSchema.safeParse({
          ...failed,
          [field]: 'sk-secret /private/provider-response',
        }).success,
      ).toBe(false);
    },
  );
});
