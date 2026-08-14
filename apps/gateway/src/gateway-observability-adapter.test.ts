import { Logger, MemorySink, sinkOf } from '@educanvas/logging';
import { describe, expect, it } from 'vitest';
import { createGatewayObservabilitySink } from './gateway-observability-adapter';
import type { SafeLogRecord } from './observability';

function makeAdapter() {
  const sink = new MemorySink();
  const logger = new Logger({
    service: 'gateway',
    sink: sinkOf(sink),
    now: () => new Date('2026-08-14T18:23:39.102Z'),
  });
  return { sink, emit: createGatewayObservabilitySink(logger) };
}

const httpRecord = (
  overrides: Partial<Extract<SafeLogRecord, { event: 'gateway.http' }>> = {},
): SafeLogRecord => ({
  event: 'gateway.http',
  method: 'POST',
  route: 'client.turns',
  status: 202,
  durationMs: 43,
  ...overrides,
});

describe('createGatewayObservabilitySink', () => {
  it('HTTP 记录输出标准信封', () => {
    const { sink, emit } = makeAdapter();
    emit(httpRecord());
    const record = sink.records[0]!;
    expect(record.schema).toBe('educanvas.log.v1');
    expect(record.level).toBe('info');
    expect(record.service).toBe('gateway');
    expect(record.component).toBeUndefined();
    expect(record.event).toBe('gateway.http.completed');
    expect(record.message).toBe('客户端请求完成');
    expect(record.method).toBe('POST');
    expect(record.route).toBe('client.turns');
    expect(record.status).toBe(202);
    expect(record.durationMs).toBe(43);
  });

  it('5xx 映射为 error', () => {
    const { sink, emit } = makeAdapter();
    emit(httpRecord({ status: 500 }));
    expect(sink.records[0]!.level).toBe('error');
    expect(sink.records[0]!.message).toBe('服务端错误');
  });

  it('429 映射为 warn', () => {
    const { sink, emit } = makeAdapter();
    emit(httpRecord({ status: 429 }));
    expect(sink.records[0]!.level).toBe('warn');
    expect(sink.records[0]!.message).toBe('请求被限流');
  });

  it('健康检查成功降噪为 debug', () => {
    const { sink, emit } = makeAdapter();
    emit(httpRecord({ method: 'GET', route: 'health', status: 200 }));
    expect(sink.records[0]!.level).toBe('debug');
  });

  it('普通预期 4xx 不染成 error', () => {
    const { sink, emit } = makeAdapter();
    emit(httpRecord({ status: 403 }));
    expect(sink.records[0]!.level).toBe('info');
  });

  it('operation 记录映射为 transitioned 事件', () => {
    const { sink, emit } = makeAdapter();
    emit({
      event: 'gateway.operation',
      operationId: 'op-7a31c2',
      eventType: 'operation.accepted',
      sequence: 3,
    });
    const record = sink.records[0]!;
    expect(record.event).toBe('gateway.operation.transitioned');
    expect(record.operationId).toBe('op-7a31c2');
    expect(record.eventType).toBe('operation.accepted');
    expect(record.sequence).toBe(3);
  });

  it('安全边界保留：不记录正文、URL 参数或令牌', () => {
    const { sink, emit } = makeAdapter();
    emit(httpRecord({ route: 'client.operation.events' }));
    emit({
      event: 'gateway.operation',
      operationId: 'op-secret-id',
      eventType: 'operation.completed',
      sequence: 1,
    });
    const serialized = JSON.stringify(sink.records);
    expect(serialized).not.toContain('Authorization');
    expect(serialized).not.toContain('Bearer');
  });
});
