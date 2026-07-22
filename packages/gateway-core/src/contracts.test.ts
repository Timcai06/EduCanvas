import { describe, expect, it } from 'vitest';
import {
  gatewayCapabilityManifestSchema,
  gatewayDeliveryReceiptSchema,
  gatewayEventBatchSchema,
  gatewayInboundEnvelopeSchema,
  gatewayNodeInvocationRequestSchema,
  gatewayOperationEventSchema,
  gatewayProtocolVersion,
  gatewayResolvedRouteSchema,
  isGatewayTerminalEvent,
  isNotebookMembershipActive,
  notebookRoleAllows,
  validateGatewayEventSequence,
} from './index';

const occurredAt = '2026-07-19T04:00:00.000Z';

function makeEnvelope(transport: 'web' | 'tui') {
  return {
    protocol: gatewayProtocolVersion,
    envelopeId: `env:${transport}:1`,
    idempotencyKey: `message:${transport}:1`,
    occurredAt,
    connection: {
      connectionId: `connection:${transport}:1`,
      role: 'client',
      transport,
      adapterId: `adapter:${transport}`,
    },
    principal: {
      subjectId: 'subject:user-1',
      userId: 'user:1',
      agentId: 'agent:1',
      kind: 'user',
      authenticationMethod: 'fixture',
      authenticatedAt: occurredAt,
    },
    routeHint: {
      notebookId: 'notebook:shared-1',
      conversationId: 'conversation:1',
    },
    parts: [{ type: 'text', text: '解释一下勾股定理' }],
    capabilities: {
      manifestId: `manifest:${transport}:1`,
      issuedAt: occurredAt,
      capabilities: [
        { name: 'input.text', risk: 'l0', version: '1', constraints: {} },
        {
          name: 'output.markdown',
          risk: 'l0',
          version: '1',
          constraints: {},
        },
      ],
    },
    replyTarget: {
      kind: 'connection',
      connectionId: `connection:${transport}:1`,
    },
  } as const;
}

describe('Gateway contracts', () => {
  it('represents equivalent Web and TUI messages without surface semantics', () => {
    const web = gatewayInboundEnvelopeSchema.parse(makeEnvelope('web'));
    const tui = gatewayInboundEnvelopeSchema.parse(makeEnvelope('tui'));

    expect(web.parts).toEqual(tui.parts);
    expect(web.routeHint).toEqual(tui.routeHint);
    expect(web.principal.agentId).toBe(tui.principal.agentId);
    expect(web.connection.transport).not.toBe(tui.connection.transport);
  });

  it('rejects fields outside the frozen envelope', () => {
    expect(() =>
      gatewayInboundEnvelopeSchema.parse({
        ...makeEnvelope('web'),
        modelProvider: 'untrusted-client-choice',
      }),
    ).toThrow();
  });

  it('accepts only canonical server-resolved Agent Profile identifiers', () => {
    const route = {
      actorUserId: 'user:1',
      agentId: 'agent:1',
      notebookId: 'notebook:shared-1',
      conversationId: 'conversation:1',
      agentProfileId: 'k12.teacher',
      membershipRole: 'owner',
    };

    expect(gatewayResolvedRouteSchema.parse(route).agentProfileId).toBe(
      'k12.teacher',
    );
    expect(() =>
      gatewayResolvedRouteSchema.parse({
        ...route,
        agentProfileId: 'K12 Teacher',
      }),
    ).toThrow();
    expect(() =>
      gatewayResolvedRouteSchema.parse({
        ...route,
        agentProfileId: `a${'b'.repeat(128)}`,
      }),
    ).toThrow();
  });

  it('rejects duplicate capability declarations', () => {
    expect(() =>
      gatewayCapabilityManifestSchema.parse({
        manifestId: 'manifest:1',
        issuedAt: occurredAt,
        capabilities: [
          { name: 'input.text', risk: 'l0', version: '1' },
          { name: 'input.text', risk: 'l0', version: '2' },
        ],
      }),
    ).toThrow(/unique/);
  });

  it('keeps shared Notebook role permissions explicit', () => {
    expect(notebookRoleAllows('viewer', 'notebook.read')).toBe(true);
    expect(notebookRoleAllows('viewer', 'conversation.reply')).toBe(false);
    expect(notebookRoleAllows('contributor', 'artifact.write')).toBe(true);
    expect(notebookRoleAllows('editor', 'notebook.manage')).toBe(false);
    expect(notebookRoleAllows('owner', 'notebook.manage')).toBe(true);
  });

  it('treats expired and revoked Notebook memberships as inactive', () => {
    const base = {
      notebookId: 'notebook:1',
      userId: 'user:1',
      role: 'viewer' as const,
      grantedByUserId: 'user:owner',
      grantedAt: '2026-07-19T03:00:00.000Z',
      expiresAt: '2026-07-19T05:00:00.000Z',
      revokedAt: null,
    };
    expect(
      isNotebookMembershipActive(base, new Date('2026-07-19T04:00:00.000Z')),
    ).toBe(true);
    expect(
      isNotebookMembershipActive(base, new Date('2026-07-19T06:00:00.000Z')),
    ).toBe(false);
    expect(
      isNotebookMembershipActive(
        { ...base, revokedAt: '2026-07-19T03:30:00.000Z' },
        new Date('2026-07-19T04:00:00.000Z'),
      ),
    ).toBe(false);
  });

  it('requires strictly ordered events and one terminal suffix', () => {
    const accepted = gatewayOperationEventSchema.parse({
      protocol: gatewayProtocolVersion,
      eventId: 'event:1',
      operationId: 'operation:1',
      sequence: 0,
      occurredAt,
      type: 'operation.accepted',
    });
    const completed = gatewayOperationEventSchema.parse({
      protocol: gatewayProtocolVersion,
      eventId: 'event:2',
      operationId: 'operation:1',
      sequence: 1,
      occurredAt,
      type: 'operation.completed',
      messageId: 'message:1',
    });

    expect(isGatewayTerminalEvent(accepted)).toBe(false);
    expect(isGatewayTerminalEvent(completed)).toBe(true);
    expect(validateGatewayEventSequence([accepted, completed])).toBe(true);
    expect(validateGatewayEventSequence([completed, accepted])).toBe(false);
    expect(validateGatewayEventSequence([accepted, completed, completed])).toBe(
      false,
    );
    expect(
      gatewayEventBatchSchema.parse({
        operationId: 'operation:1',
        events: [accepted, completed],
        nextCursor: { operationId: 'operation:1', afterSequence: 1 },
      }).events,
    ).toHaveLength(2);
  });

  it('rejects unsafe Node capabilities and malformed delivery failures', () => {
    expect(() =>
      gatewayNodeInvocationRequestSchema.parse({
        requestId: 'request:1',
        operationId: 'operation:1',
        nodeId: 'node:1',
        capability: 'output.markdown',
        parameters: {},
        nonce: 'nonce:1',
        issuedAt: occurredAt,
        expiresAt: '2026-07-19T04:01:00.000Z',
      }),
    ).toThrow(/not invokable/);

    expect(() =>
      gatewayDeliveryReceiptSchema.parse({
        deliveryId: 'delivery:1',
        envelopeId: 'envelope:1',
        operationId: 'operation:1',
        status: 'failed',
        attempt: 1,
        occurredAt,
        externalMessageId: null,
        failureCode: null,
      }),
    ).toThrow(/failure code/);
  });
});
