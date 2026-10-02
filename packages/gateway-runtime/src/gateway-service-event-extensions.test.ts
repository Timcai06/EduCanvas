import {
  gatewayProtocolVersion,
  type GatewayInboundEnvelope,
  type GatewayOperationEvent,
} from '@educanvas/gateway-core';
import { describe, expect, it } from 'vitest';
import { GatewayCancellationRegistry } from './cancellation';
import { Sha256GatewayRequestFingerprint } from './fingerprint';
import {
  InMemoryGatewayOperationStore,
  InMemoryGatewayRouteResolver,
  SequentialGatewayIdFactory,
} from './in-memory';
import { GatewayService } from './gateway-service';
import type { GatewayTurnRunnerPort } from './ports';

const now = new Date('2026-07-19T04:00:00.000Z');

const legacyStrictV1Reader = {
  safeParse(value: unknown): { success: boolean } {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return { success: false };
    }
    const event = value as Record<string, unknown>;
    const baseKeys = [
      'protocol',
      'eventId',
      'operationId',
      'sequence',
      'occurredAt',
      'type',
    ];
    const eventKeys =
      event.type === 'operation.accepted'
        ? baseKeys
        : event.type === 'operation.failed'
          ? [...baseKeys, 'code', 'retryable']
          : [];
    const keys = Object.keys(event).sort();
    const expectedKeys = [...eventKeys].sort();
    const exactShape =
      keys.length === expectedKeys.length &&
      keys.every((key, index) => key === expectedKeys[index]);
    const validBase =
      event.protocol === 'gateway.v1' &&
      typeof event.eventId === 'string' &&
      typeof event.operationId === 'string' &&
      typeof event.sequence === 'number' &&
      typeof event.occurredAt === 'string';
    const validFailure =
      event.type !== 'operation.failed' ||
      (typeof event.code === 'string' && typeof event.retryable === 'boolean');
    return {
      success: eventKeys.length > 0 && exactShape && validBase && validFailure,
    };
  },
};

function envelope(): GatewayInboundEnvelope {
  return {
    protocol: gatewayProtocolVersion,
    envelopeId: 'envelope:1',
    idempotencyKey: 'message:1',
    occurredAt: now.toISOString(),
    connection: {
      connectionId: 'connection:web:1',
      role: 'client',
      transport: 'web',
      adapterId: 'adapter:web',
    },
    principal: {
      subjectId: 'subject:user-1',
      userId: 'user:1',
      agentId: 'agent:1',
      kind: 'user',
      authenticationMethod: 'fixture',
      authenticatedAt: now.toISOString(),
    },
    routeHint: { notebookId: 'notebook:1', conversationId: 'conversation:1' },
    parts: [{ type: 'text', text: 'create artifact' }],
    capabilities: {
      manifestId: 'manifest:web:1',
      issuedAt: now.toISOString(),
      capabilities: [
        { name: 'input.text', risk: 'l0', version: '1', constraints: {} },
        { name: 'output.stream', risk: 'l0', version: '1', constraints: {} },
      ],
    },
    replyTarget: { kind: 'connection', connectionId: 'connection:web:1' },
  };
}

function withArtifactConfirmationV1(
  request: GatewayInboundEnvelope,
): GatewayInboundEnvelope {
  return {
    ...request,
    capabilities: {
      ...request.capabilities,
      capabilities: [
        ...request.capabilities.capabilities,
        {
          name: 'artifact.confirmation',
          risk: 'l0',
          version: '1',
          constraints: {},
        },
      ],
    },
  };
}

function buildService(runner: GatewayTurnRunnerPort) {
  const route = {
    actorUserId: 'user:1',
    agentId: 'agent:1',
    notebookId: 'notebook:1',
    conversationId: 'conversation:1',
    agentProfileId: 'general',
    membershipRole: 'owner' as const,
  };
  const resolver = new InMemoryGatewayRouteResolver([
    {
      route,
      membership: {
        notebookId: 'notebook:1',
        userId: 'user:1',
        role: 'owner',
        grantedByUserId: 'user:1',
        grantedAt: '2026-07-19T03:00:00.000Z',
        expiresAt: null,
        revokedAt: null,
      },
    },
  ]);
  const service = new GatewayService(
    resolver,
    new InMemoryGatewayOperationStore(new SequentialGatewayIdFactory()),
    runner,
    new Sha256GatewayRequestFingerprint(),
    () => now,
    new GatewayCancellationRegistry(),
  );
  return service;
}

async function collect(iterable: AsyncIterable<GatewayOperationEvent>) {
  const events: GatewayOperationEvent[] = [];
  for await (const event of iterable) events.push(event);
  return events;
}

describe('GatewayService event extensions', () => {
  it('fails closed when a v1 client did not negotiate the produced event', async () => {
    const service = buildService({
      async *run() {
        yield {
          type: 'artifact.confirmation_required',
          confirmationId: 'confirmation:1',
          artifactKind: 'note',
          title: 'Study notes',
        };
        yield { type: 'operation.completed', messageId: 'message:assistant:1' };
      },
    });

    const events = await collect(service.handle(envelope()));
    expect(events.map((event) => event.type)).toEqual([
      'operation.accepted',
      'operation.failed',
    ]);
    expect(
      events.every((event) => legacyStrictV1Reader.safeParse(event).success),
    ).toBe(true);
    expect(
      legacyStrictV1Reader.safeParse({
        protocol: 'gateway.v1',
        eventId: 'event:extension',
        operationId: events[0]!.operationId,
        sequence: 1,
        occurredAt: now.toISOString(),
        type: 'artifact.confirmation_required',
        confirmationId: 'confirmation:1',
        artifactKind: 'note',
        title: 'Study notes',
      }).success,
    ).toBe(false);
    expect(events.at(-1)).toMatchObject({
      code: 'CAPABILITY_UNAVAILABLE',
      retryable: false,
    });
  });

  it('replays and resumes confirmation v1 only for clients that declare it', async () => {
    let runnerCalls = 0;
    const service = buildService({
      async *run() {
        runnerCalls += 1;
        yield {
          type: 'artifact.confirmation_required',
          confirmationId: 'confirmation:1',
          artifactKind: 'note',
          title: 'Study notes',
        };
        yield { type: 'operation.completed', messageId: 'message:assistant:1' };
      },
    });
    const request = withArtifactConfirmationV1(envelope());
    const first = await collect(service.handle(request));
    const replay = await collect(service.handle(request));
    const operationId = first[0]!.operationId;

    expect(first.map((event) => event.type)).toEqual([
      'operation.accepted',
      'artifact.confirmation_required',
      'operation.completed',
    ]);
    expect(replay).toEqual(first);
    expect(runnerCalls).toBe(1);
    await expect(
      service.resume({
        operationId,
        afterSequence: 1,
        principalUserId: 'user:1',
      }),
    ).rejects.toMatchObject({ code: 'CAPABILITY_UNAVAILABLE' });
    await expect(
      service.resume({
        operationId,
        afterSequence: 0,
        principalUserId: 'user:1',
        eventExtensions: ['artifact.confirmation@1'],
      }),
    ).resolves.toMatchObject([
      { type: 'artifact.confirmation_required', sequence: 1 },
      { type: 'operation.completed', sequence: 2 },
    ]);
  });
});
