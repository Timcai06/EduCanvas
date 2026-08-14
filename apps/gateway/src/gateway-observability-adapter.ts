import type { Logger, LogLevel } from '@educanvas/logging';
import type { SafeLogRecord } from './observability';

/**
 * GatewayObservability → 统一日志信封适配。
 *
 * 保留 GatewayObservability 的低基数路由标签与敏感数据边界（不在此处
 * 新增任何字段），只做两层转换：
 * 1. 事件名迁移到统一协议（`gateway.http` → `gateway.http.completed`）；
 * 2. 级别语义化：5xx=error、429=warn、健康检查成功=debug（降噪）、
 *    普通预期 4xx=info。
 */

function httpLevel(
  record: Extract<SafeLogRecord, { event: 'gateway.http' }>,
): LogLevel {
  if (record.status >= 500) return 'error';
  if (record.status === 429) return 'warn';
  if (record.route === 'health' && record.status < 500) return 'debug';
  return 'info';
}

function httpMessage(
  record: Extract<SafeLogRecord, { event: 'gateway.http' }>,
): string {
  if (record.status >= 500) return '服务端错误';
  if (record.status === 429) return '请求被限流';
  if (record.route === 'health') return '健康检查完成';
  if (record.status >= 400) return '客户端请求被拒绝';
  return '客户端请求完成';
}

/** 构造 GatewayObservability 的 sink：标准信封输出。 */
export function createGatewayObservabilitySink(
  logger: Logger,
): (record: SafeLogRecord) => void {
  return (record) => {
    if (record.event === 'gateway.http') {
      logger.log(
        httpLevel(record),
        'gateway.http.completed',
        httpMessage(record),
        {
          method: record.method,
          route: record.route,
          status: record.status,
          durationMs: record.durationMs,
        },
      );
      return;
    }
    logger.info('gateway.operation.transitioned', '操作状态迁移', {
      operationId: record.operationId,
      eventType: record.eventType,
      sequence: record.sequence,
    });
  };
}
