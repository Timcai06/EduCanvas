import type {
  GatewayInboundEnvelope,
  GatewayOperationEvent,
  GatewayPrincipal,
  GatewayResolvedRoute,
  NotebookPermission,
} from '@educanvas/gateway-core';
import type { ModelAbortSignal } from '@educanvas/agent-core';

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
  /** Gateway 创建并持久化的 Trace 根；下游不得另造。 */
  traceId: string;
  envelopeId: string;
  idempotencyKey: string;
  requestFingerprint: string;
  route: GatewayResolvedRoute;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  replayed: boolean;
}

/** 取消鉴权所需的最小操作描述：归属与当前终态，绝不泄露事件内容。 */
export interface GatewayOperationDescriptor {
  operationId: string;
  actorUserId: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
}

/** 会话恢复入口用的近期操作摘要：定位它属于哪个笔记本、当前状态与时间。 */
export interface GatewayRecentOperation {
  operationId: string;
  conversationId: string;
  conversationTitle: string | null;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  createdAt: string;
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
  /** 取消鉴权用：返回归属与终态；操作不存在返回 null。 */
  describe(operationId: string): Promise<GatewayOperationDescriptor | null>;
  /** 跨进程可见的取消请求；只写请求事实，不直接伪造 Operation 终态。 */
  requestCancellation(input: {
    operationId: string;
    actorUserId: string;
    now: Date;
  }): Promise<boolean>;
}

export interface GatewayTurnRunnerPort {
  run(input: {
    operationId: string;
    traceId: string;
    envelope: GatewayInboundEnvelope;
    route: GatewayResolvedRoute;
    signal: ModelAbortSignal;
  }): AsyncIterable<GatewayEventPayload>;
}

export interface GatewayRequestFingerprintPort {
  fingerprint(envelope: GatewayInboundEnvelope): string;
}

export interface GatewayIdFactoryPort {
  createId(kind: 'operation' | 'event'): string;
}
