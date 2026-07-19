import {
  gatewayInboundEnvelopeSchema,
  isGatewayTerminalEvent,
  type GatewayInboundEnvelope,
  type GatewayOperationEvent,
} from '@educanvas/gateway-core';
import { GatewayRuntimeError } from './errors';
import type {
  GatewayEventPayload,
  GatewayOperationStorePort,
  GatewayRequestFingerprintPort,
  GatewayRouteResolverPort,
  GatewayTurnRunnerPort,
} from './ports';

const failurePayload = (
  code: Extract<GatewayEventPayload, { type: 'operation.failed' }>['code'],
): Extract<GatewayEventPayload, { type: 'operation.failed' }> => ({
  type: 'operation.failed',
  code,
  retryable: code === 'RUNTIME_FAILED' || code === 'RATE_LIMITED',
});

export class GatewayService {
  constructor(
    private readonly routeResolver: GatewayRouteResolverPort,
    private readonly operationStore: GatewayOperationStorePort,
    private readonly turnRunner: GatewayTurnRunnerPort,
    private readonly fingerprint: GatewayRequestFingerprintPort,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async *handle(rawEnvelope: unknown): AsyncIterable<GatewayOperationEvent> {
    const envelope = gatewayInboundEnvelopeSchema.parse(rawEnvelope);
    const route = await this.routeResolver.resolve({
      principal: envelope.principal,
      routeHint: envelope.routeHint,
      requiredPermission: 'conversation.reply',
      now: this.now(),
    });
    if (
      route.actorUserId !== envelope.principal.userId ||
      route.agentId !== envelope.principal.agentId
    ) {
      throw new GatewayRuntimeError(
        'FORBIDDEN',
        'Resolved route does not belong to the authenticated principal',
      );
    }

    const operation = await this.operationStore.begin({
      envelopeId: envelope.envelopeId,
      idempotencyKey: envelope.idempotencyKey,
      requestFingerprint: this.fingerprint.fingerprint(envelope),
      route,
      now: this.now(),
    });

    if (operation.replayed) {
      for (const event of await this.operationStore.listEvents(
        operation.operationId,
        -1,
        route.actorUserId,
      )) {
        yield event.type === 'message.started'
          ? { ...event, replayed: true }
          : event;
      }
      return;
    }

    yield await this.operationStore.append(
      operation.operationId,
      { type: 'operation.accepted' },
      this.now(),
    );

    let terminalSeen = false;
    let approvalPending = false;
    try {
      for await (const payload of this.turnRunner.run({
        operationId: operation.operationId,
        envelope,
        route,
      })) {
        const event = await this.operationStore.append(
          operation.operationId,
          payload,
          this.now(),
        );
        yield event;
        if (isGatewayTerminalEvent(event)) {
          terminalSeen = true;
          break;
        }
        if (event.type === 'approval.required') approvalPending = true;
      }
    } catch {
      if (!terminalSeen) {
        terminalSeen = true;
        yield await this.operationStore.append(
          operation.operationId,
          failurePayload('RUNTIME_FAILED'),
          this.now(),
        );
      }
    }

    if (!terminalSeen && !approvalPending) {
      yield await this.operationStore.append(
        operation.operationId,
        failurePayload('RUNTIME_FAILED'),
        this.now(),
      );
    }
  }

  async resume(input: {
    operationId: string;
    afterSequence: number;
    principalUserId: string;
  }): Promise<readonly GatewayOperationEvent[]> {
    return this.operationStore.listEvents(
      input.operationId,
      input.afterSequence,
      input.principalUserId,
    );
  }
}

export type { GatewayInboundEnvelope };
