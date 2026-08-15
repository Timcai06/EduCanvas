import { describe, expect, it } from 'vitest';
import { Logger } from './logger.js';
import { MemorySink, sinkOf } from './testing.js';

const FIXED_NOW = new Date('2026-08-14T18:23:39.102Z');

function makeLogger() {
  const sink = new MemorySink();
  const logger = new Logger({
    service: 'worker',
    component: 'queue',
    runId: 'local-20260814-112339-a7f2',
    sink: sinkOf(sink),
    now: () => FIXED_NOW,
  });
  return { sink, logger };
}

describe('Logger', () => {
  it('输出标准信封字段', () => {
    const { sink, logger } = makeLogger();
    logger.info('worker.ready', '后台任务 Worker 已就绪', {
      taskCount: 8,
      concurrency: 2,
    });
    const record = sink.records[0]!;
    expect(record.schema).toBe('educanvas.log.v1');
    expect(record.ts).toBe('2026-08-14T18:23:39.102Z');
    expect(record.level).toBe('info');
    expect(record.service).toBe('worker');
    expect(record.component).toBe('queue');
    expect(record.runId).toBe('local-20260814-112339-a7f2');
    expect(record.event).toBe('worker.ready');
    expect(record.message).toBe('后台任务 Worker 已就绪');
    expect(record.pid).toBeTypeOf('number');
    expect(record.taskCount).toBe(8);
    expect(record.concurrency).toBe(2);
  });

  it('低级别日志被 minLevel 过滤', () => {
    const sink = new MemorySink();
    const quiet = new Logger({
      service: 'worker',
      sink: sinkOf(sink),
      minLevel: 'warn',
      now: () => FIXED_NOW,
    });
    quiet.debug('x', '看不到');
    quiet.info('x', '看不到');
    quiet.warn('x', '能看到');
    expect(sink.records.map((record) => record.level)).toEqual(['warn']);
  });

  it('message 中的 ANSI 被剥离', () => {
    const { sink, logger } = makeLogger();
    logger.info('x', '\x1b[31m红字\x1b[0m消息');
    expect(sink.records[0]!.message).toBe('红字消息');
    expect(sink.records[0]!.message).not.toContain('\x1b');
  });

  it('附加字段中敏感键被脱敏', () => {
    const { sink, logger } = makeLogger();
    logger.info('x', '消息', {
      Authorization: 'Bearer secret-token',
      headers: { Cookie: 'session=abc' },
      route: 'client.turns',
    });
    const record = sink.records[0]!;
    expect(record.Authorization).toBe('[REDACTED]');
    expect((record.headers as Record<string, unknown>).Cookie).toBe(
      '[REDACTED]',
    );
    expect(record.route).toBe('client.turns');
  });

  it('错误走安全序列化，不泄漏堆栈与连接串', () => {
    const { sink, logger } = makeLogger();
    const error = Object.assign(new Error('连接失败'), {
      code: 'DB_UNREACHABLE',
      retryable: true,
    });
    logger.errorWithError('database.failed', '数据库连接失败', error);
    const record = sink.records[0]!;
    expect(record.error).toEqual({
      name: 'Error',
      code: 'DB_UNREACHABLE',
      message: '连接失败',
      retryable: true,
    });
    expect(JSON.stringify(record)).not.toContain('at ');
    expect(JSON.stringify(record)).not.toContain('DATABASE_URL');
  });

  it('child 保留服务名并覆盖 component', () => {
    const { sink, logger } = makeLogger();
    logger.child('http').info('gateway.http.completed', '请求完成');
    expect(sink.records[0]!.service).toBe('worker');
    expect(sink.records[0]!.component).toBe('http');
  });

  it('sink 抛错时降级写 stderr，不向上抛', () => {
    const spy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
    const logger = new Logger({
      service: 'worker',
      sink: () => {
        throw new Error('disk full');
      },
      now: () => FIXED_NOW,
    });
    expect(() => logger.info('x', '消息')).not.toThrow();
    spy.mockRestore();
  });
});
