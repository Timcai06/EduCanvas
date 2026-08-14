import { describe, expect, it } from 'vitest';
import {
  getLogContext,
  mergeLogContext,
  runWithLogContext,
} from './context.js';
import { Logger } from './logger.js';
import { MemorySink, sinkOf } from './testing.js';

describe('runWithLogContext', () => {
  it('异步链内日志自动携带关联 ID', async () => {
    const sink = new MemorySink();
    const logger = new Logger({ service: 'gateway', sink: sinkOf(sink) });

    await runWithLogContext({ operationId: 'op-1' }, async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      logger.info('gateway.operation.transitioned', '操作已接受');
    });

    expect(sink.records[0]!.operationId).toBe('op-1');
  });

  it('链外日志不携带关联 ID', () => {
    const sink = new MemorySink();
    const logger = new Logger({ service: 'gateway', sink: sinkOf(sink) });
    logger.info('x', '无上下文');
    expect(sink.records[0]!.operationId).toBeUndefined();
  });
});

describe('mergeLogContext', () => {
  it('叠加不覆盖已有值', () => {
    const merged = mergeLogContext(
      { operationId: 'op-1', requestId: 'r-1' },
      { operationId: 'op-2', traceId: 't-1' },
    );
    expect(merged.operationId).toBe('op-1');
    expect(merged.requestId).toBe('r-1');
    expect(merged.traceId).toBe('t-1');
  });
});

describe('Logger.withContext', () => {
  it('绑定固定关联 ID', () => {
    const sink = new MemorySink();
    const logger = new Logger({ service: 'worker', sink: sinkOf(sink) });
    logger.withContext({ jobId: 'job-481' }).info('worker.job.started', '开始');
    expect(sink.records[0]!.jobId).toBe('job-481');
  });

  it('显式字段优先于上下文', () => {
    const sink = new MemorySink();
    const logger = new Logger({ service: 'worker', sink: sinkOf(sink) });
    logger
      .withContext({ jobId: 'job-1' })
      .info('worker.job.started', '开始', { jobId: 'job-2' });
    expect(sink.records[0]!.jobId).toBe('job-2');
  });
});

describe('getLogContext', () => {
  it('无上下文时返回空对象', () => {
    expect(getLogContext()).toEqual({});
  });
});
