import {
  gatewayOperationEventSchema,
  gatewayProtocolVersion,
  isGatewayTerminalEvent,
  isNotebookMembershipActive,
  notebookRoleAllows,
  type GatewayOperationEvent,
  type GatewayPrincipal,
  type GatewayResolvedRoute,
  type NotebookMembership,
  type NotebookPermission,
} from '@educanvas/gateway-core';
import { GatewayRuntimeError } from './errors';
import type {
  GatewayEventPayload,
  GatewayIdFactoryPort,
  GatewayOperationDescriptor,
  GatewayOperationSnapshot,
  GatewayOperationStorePort,
  GatewayRecentOperation,
  GatewayRouteResolverPort,
} from './ports';

interface RouteRegistration {
  route: GatewayResolvedRoute;
  membership: NotebookMembership;
}

export class InMemoryGatewayRouteResolver implements GatewayRouteResolverPort {
  constructor(private readonly registrations: readonly RouteRegistration[]) {}

  async resolve(input: {
    principal: GatewayPrincipal;
    routeHint: { notebookId?: string; conversationId?: string };
    requiredPermission: NotebookPermission;
    now: Date;
  }): Promise<GatewayResolvedRoute> {
    const registration = this.registrations.find(
      ({ route, membership }) =>
        membership.userId === input.principal.userId &&
        route.agentId === input.principal.agentId &&
        (input.routeHint.notebookId === undefined ||
          route.notebookId === input.routeHint.notebookId) &&
        (input.routeHint.conversationId === undefined ||
          route.conversationId === input.routeHint.conversationId),
    );
    if (!registration) {
      throw new GatewayRuntimeError('ROUTE_NOT_FOUND', 'Route not found');
    }
    if (
      !isNotebookMembershipActive(registration.membership, input.now) ||
      !notebookRoleAllows(
        registration.membership.role,
        input.requiredPermission,
      )
    ) {
      throw new GatewayRuntimeError('FORBIDDEN', 'Notebook access denied');
    }
    return registration.route;
  }
}

interface StoredOperation extends GatewayOperationSnapshot {
  route: GatewayResolvedRoute;
  events: GatewayOperationEvent[];
  createdAt: string;
  cancelRequestedAt: string | null;
}

function toOperationSnapshot(
  operation: StoredOperation,
  replayed: boolean,
): GatewayOperationSnapshot {
  return {
    operationId: operation.operationId,
    traceId: operation.traceId,
    envelopeId: operation.envelopeId,
    idempotencyKey: operation.idempotencyKey,
    requestFingerprint: operation.requestFingerprint,
    status: operation.status,
    replayed,
  };
}

export class InMemoryGatewayOperationStore implements GatewayOperationStorePort {
  private readonly operations = new Map<string, StoredOperation>();
  private readonly idempotency = new Map<string, string>();

  constructor(private readonly idFactory: GatewayIdFactoryPort) {}

  async begin(input: {
    envelopeId: string;
    idempotencyKey: string;
    requestFingerprint: string;
    route: GatewayResolvedRoute;
    now: Date;
  }): Promise<GatewayOperationSnapshot> {
    const key = `${input.route.actorUserId}:${input.route.conversationId}:${input.idempotencyKey}`;
    const existingId = this.idempotency.get(key);
    if (existingId !== undefined) {
      const existing = this.operations.get(existingId);
      if (!existing) {
        throw new GatewayRuntimeError(
          'OPERATION_NOT_FOUND',
          'Idempotency record is incomplete',
        );
      }
      if (existing.requestFingerprint !== input.requestFingerprint) {
        throw new GatewayRuntimeError(
          'IDEMPOTENCY_CONFLICT',
          'Idempotency key is already bound to different input',
        );
      }
      return toOperationSnapshot(existing, true);
    }
    const operationId = this.idFactory.createId('operation');
    const operation: StoredOperation = {
      operationId,
      traceId: `trace:${operationId}`,
      envelopeId: input.envelopeId,
      idempotencyKey: input.idempotencyKey,
      requestFingerprint: input.requestFingerprint,
      route: input.route,
      status: 'running',
      replayed: false,
      events: [],
      createdAt: input.now.toISOString(),
      cancelRequestedAt: null,
    };
    this.operations.set(operationId, operation);
    this.idempotency.set(key, operationId);
    return toOperationSnapshot(operation, false);
  }

  async append(
    operationId: string,
    payload: GatewayEventPayload,
    now: Date,
  ): Promise<GatewayOperationEvent> {
    const operation = this.operations.get(operationId);
    if (!operation) {
      throw new GatewayRuntimeError(
        'OPERATION_NOT_FOUND',
        'Operation not found',
      );
    }
    if (operation.status !== 'running') {
      throw new GatewayRuntimeError(
        'INVALID_EVENT_SEQUENCE',
        'Cannot append after terminal event',
      );
    }
    const event = gatewayOperationEventSchema.parse({
      ...payload,
      protocol: gatewayProtocolVersion,
      eventId: this.idFactory.createId('event'),
      operationId,
      sequence: operation.events.length,
      occurredAt: now.toISOString(),
    });
    operation.events.push(event);
    if (isGatewayTerminalEvent(event)) {
      operation.status =
        event.type === 'operation.completed'
          ? 'completed'
          : event.type === 'operation.cancelled'
            ? 'cancelled'
            : 'failed';
    }
    return event;
  }

  async listEvents(
    operationId: string,
    afterSequence: number,
    actorUserId: string,
  ): Promise<readonly GatewayOperationEvent[]> {
    const operation = this.operations.get(operationId);
    if (!operation) {
      throw new GatewayRuntimeError(
        'OPERATION_NOT_FOUND',
        'Operation not found',
      );
    }
    if (operation.route.actorUserId !== actorUserId) {
      throw new GatewayRuntimeError('FORBIDDEN', 'Operation access denied');
    }
    return operation.events.filter((event) => event.sequence > afterSequence);
  }

  async describe(
    operationId: string,
  ): Promise<GatewayOperationDescriptor | null> {
    const operation = this.operations.get(operationId);
    if (!operation) return null;
    return {
      operationId,
      actorUserId: operation.route.actorUserId,
      status: operation.status,
    };
  }

  async requestCancellation(input: {
    operationId: string;
    actorUserId: string;
    now: Date;
  }): Promise<{
    recorded: boolean;
    continuation: 'none' | 'running' | 'cancelled';
  }> {
    const operation = this.operations.get(input.operationId);
    if (
      !operation ||
      operation.route.actorUserId !== input.actorUserId ||
      operation.status !== 'running'
    ) {
      return { recorded: false, continuation: 'none' };
    }
    operation.cancelRequestedAt ??= input.now.toISOString();
    return { recorded: true, continuation: 'none' };
  }

  async listRecent(
    actorUserId: string,
    limit = 20,
  ): Promise<readonly GatewayRecentOperation[]> {
    return [...this.operations.values()]
      .filter((operation) => operation.route.actorUserId === actorUserId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, Math.min(Math.max(limit, 1), 50))
      .map((operation) => ({
        operationId: operation.operationId,
        conversationId: operation.route.conversationId,
        conversationTitle: null,
        status: operation.status,
        createdAt: operation.createdAt,
      }));
  }
}

export class SequentialGatewayIdFactory implements GatewayIdFactoryPort {
  private sequence = 0;

  createId(kind: 'operation' | 'event'): string {
    this.sequence += 1;
    return `${kind}:${this.sequence}`;
  }
}
