import type { GatewayOperationEvent } from '@educanvas/gateway-core';

export interface GatewayMetricsSnapshot {
  httpRequestsTotal: number;
  httpErrorsTotal: number;
  activeHttpRequests: number;
  operationEventsTotal: number;
  operationTerminalsTotal: number;
}

type SafeLogRecord =
  | {
      event: 'gateway.http';
      method: string;
      route: string;
      status: number;
      durationMs: number;
    }
  | {
      event: 'gateway.operation';
      operationId: string;
      eventType: string;
      sequence: number;
    };

const terminalEvents = new Set([
  'operation.completed',
  'operation.failed',
  'operation.cancelled',
]);

/**
 * Gateway 的低基数进程内指标和安全结构化日志。日志只包含固定路由标签、状态、
 * 时延和操作 ID，不记录 URL 参数、请求正文、消息、令牌或未清洗异常。
 */
export class GatewayObservability {
  private httpRequestsTotal = 0;
  private httpErrorsTotal = 0;
  private activeHttpRequests = 0;
  private operationEventsTotal = 0;
  private operationTerminalsTotal = 0;

  constructor(
    private readonly sink: (record: SafeLogRecord) => void = () => undefined,
    private readonly now: () => number = () => Date.now(),
  ) {}

  beginHttp(input: {
    method: string;
    route: string;
  }): (status: number) => void {
    this.activeHttpRequests += 1;
    const startedAt = this.now();
    let settled = false;
    return (status) => {
      if (settled) return;
      settled = true;
      this.activeHttpRequests = Math.max(0, this.activeHttpRequests - 1);
      this.httpRequestsTotal += 1;
      if (status >= 400) this.httpErrorsTotal += 1;
      this.sink({
        event: 'gateway.http',
        method: input.method,
        route: input.route,
        status,
        durationMs: Math.max(0, this.now() - startedAt),
      });
    };
  }

  operation(event: GatewayOperationEvent): void {
    this.operationEventsTotal += 1;
    if (terminalEvents.has(event.type)) this.operationTerminalsTotal += 1;
    if (
      event.type === 'operation.accepted' ||
      terminalEvents.has(event.type) ||
      event.type === 'approval.required' ||
      event.type === 'approval.resolved'
    ) {
      this.sink({
        event: 'gateway.operation',
        operationId: event.operationId,
        eventType: event.type,
        sequence: event.sequence,
      });
    }
  }

  snapshot(): GatewayMetricsSnapshot {
    return {
      httpRequestsTotal: this.httpRequestsTotal,
      httpErrorsTotal: this.httpErrorsTotal,
      activeHttpRequests: this.activeHttpRequests,
      operationEventsTotal: this.operationEventsTotal,
      operationTerminalsTotal: this.operationTerminalsTotal,
    };
  }
}

export function gatewayRouteLabel(method: string, pathname: string): string {
  if (pathname === '/healthz') return 'health';
  if (pathname === '/v1/internal/metrics') return 'internal.metrics';
  if (pathname === '/v1/internal/envelopes') return 'internal.envelopes';
  if (/^\/v1\/internal\/operations\/[^/]+\/events$/.test(pathname)) {
    return 'internal.operation.events';
  }
  if (/^\/v1\/internal\/nodes\/[^/]+\/invocations$/.test(pathname)) {
    return 'internal.node.invocations';
  }
  if (pathname === '/v1/client/bootstrap') return 'client.bootstrap';
  if (pathname === '/v1/local/onboard') return 'local.onboard';
  if (pathname === '/v1/client/conversations') return 'client.conversations';
  if (pathname === '/v1/client/connections') return 'client.connections';
  if (pathname === '/v1/client/connections/connect') {
    return 'client.connection.connect';
  }
  if (pathname === '/v1/client/connections/revoke') {
    return 'client.connection.revoke';
  }
  if (pathname === '/v1/client/turns') return 'client.turns';
  if (pathname === '/v1/client/approvals') return 'client.approvals';
  if (/^\/v1\/client\/approvals\/[^/]+\/decision$/.test(pathname)) {
    return 'client.approval.decision';
  }
  if (pathname === '/v1/client/operations') return 'client.operations';
  if (/^\/v1\/client\/operations\/[^/]+\/events$/.test(pathname)) {
    return 'client.operation.events';
  }
  if (/^\/v1\/client\/operations\/[^/]+\/cancel$/.test(pathname)) {
    return 'client.operation.cancel';
  }
  if (pathname === '/v1/node/pair') return 'node.pair';
  if (pathname === '/v1/node/heartbeat') return 'node.heartbeat';
  if (pathname === '/v1/node/invocations') return 'node.invocations';
  if (pathname === '/v1/node/invocation-results') return 'node.results';
  return `${method.toLowerCase()}.unknown`;
}
