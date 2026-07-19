import type {
  GatewayInboundEnvelope,
  GatewayOperationEvent,
  GatewayPrincipal,
  GatewayResolvedRoute,
  NotebookPermission,
} from '@educanvas/gateway-core';

type GatewayEventBaseKeys =
  'protocol' | 'eventId' | 'operationId' | 'sequence' | 'occurredAt';

export type GatewayEventPayload = GatewayOperationEvent extends infer Event
  ? Event extends GatewayOperationEvent
    ? Omit<Event, GatewayEventBaseKeys>
    : never
  : never;

export interface GatewayRouteResolverPort {
  resolve(input: {
    principal: GatewayPrincipal;
    routeHint: GatewayInboundEnvelope['routeHint'];
    requiredPermission: NotebookPermission;
    now: Date;
  }): Promise<GatewayResolvedRoute>;
}

export interface GatewayOperationSnapshot {
  operationId: string;
  envelopeId: string;
  idempotencyKey: string;
  requestFingerprint: string;
  route: GatewayResolvedRoute;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  replayed: boolean;
}

export interface GatewayOperationStorePort {
  begin(input: {
    envelopeId: string;
    idempotencyKey: string;
    requestFingerprint: string;
    route: GatewayResolvedRoute;
    now: Date;
  }): Promise<GatewayOperationSnapshot>;
  append(
    operationId: string,
    payload: GatewayEventPayload,
    now: Date,
  ): Promise<GatewayOperationEvent>;
  listEvents(
    operationId: string,
    afterSequence: number,
    actorUserId: string,
  ): Promise<readonly GatewayOperationEvent[]>;
}

export interface GatewayTurnRunnerPort {
  run(input: {
    operationId: string;
    envelope: GatewayInboundEnvelope;
    route: GatewayResolvedRoute;
  }): AsyncIterable<GatewayEventPayload>;
}

export interface GatewayRequestFingerprintPort {
  fingerprint(envelope: GatewayInboundEnvelope): string;
}

export interface GatewayIdFactoryPort {
  createId(kind: 'operation' | 'event'): string;
}
