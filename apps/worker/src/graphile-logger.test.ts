import { Logger, MemorySink, sinkOf } from '@educanvas/logging';
import { describe, expect, it } from 'vitest';
import { createGraphileLogger } from './graphile-logger';

function makeGraphileLogger() {
  const sink = new MemorySink();
  const logger = new Logger({
    service: 'worker',
    sink: sinkOf(sink),
    now: () => new Date('2026-08-14T18:23:39.102Z'),
  });
  const graphile = createGraphileLogger(logger);
  return { sink, graphile };
}

const JOB_META = {
  job: {
    id: 'job-481',
    task_identifier: 'generate_artifact',
    attempts: 1,
    max_attempts: 5,
    payload: { conversationId: 'secret-conversation', studentText: '正文内容' },
  },
  duration: 1290.4,
};

describe('createGraphileLogger', () => {
  it('失败任务映射为 worker.job.failed (error)', () => {
    const { sink, graphile } = makeGraphileLogger();
    graphile.error(
      `Failed task job-481 (generate_artifact) with error 'boom'`,
      {
        ...JOB_META,
        failure: true,
      },
    );
    const record = sink.records[0]!;
    expect(record.level).toBe('error');
    expect(record.event).toBe('worker.job.failed');
    expect(record.jobId).toBe('job-481');
    expect(record.taskIdentifier).toBe('generate_artifact');
    expect(record.attempt).toBe(1);
    expect(record.maxAttempts).toBe(5);
  });

  it('完成任务映射为 worker.job.completed (info) 并带 durationMs', () => {
    const { sink, graphile } = makeGraphileLogger();
    graphile.info(
      'Completed task job-481 (generate_artifact, 1290.40ms)',
      JOB_META,
    );
    const record = sink.records[0]!;
    expect(record.event).toBe('worker.job.completed');
    expect(record.level).toBe('info');
    expect(record.durationMs).toBe(1290);
  });

  it('warning 映射为 service.degraded (warn)', () => {
    const { sink, graphile } = makeGraphileLogger();
    graphile.warn('Something troublesome', {});
    const record = sink.records[0]!;
    expect(record.event).toBe('service.degraded');
    expect(record.level).toBe('warn');
  });

  it('框架内部事件映射为 debug，不污染 info 流', () => {
    const { sink, graphile } = makeGraphileLogger();
    graphile.debug('Found task job-1 (embed_knowledge_document)', {
      job: { id: 'job-1', task_identifier: 'embed_knowledge_document' },
    });
    graphile.info('Worker connected and looking for jobs...', {});
    expect(sink.records.map((record) => record.level)).toEqual([
      'debug',
      'debug',
    ]);
  });

  it('白名单纪律：payload 与正文绝不落盘', () => {
    const { sink, graphile } = makeGraphileLogger();
    graphile.error(`Failed task with error '机密内容'`, {
      ...JOB_META,
      failure: true,
    });
    const serialized = JSON.stringify(sink.records);
    expect(serialized).not.toContain('secret-conversation');
    expect(serialized).not.toContain('正文内容');
    expect(serialized).not.toContain('payload');
  });

  it('scope 中的 workerId 被采集', () => {
    const { sink, graphile } = makeGraphileLogger();
    const scoped = graphile.scope({ workerId: 'worker-01' });
    scoped.info('Completed task job-1 (x, 10.00ms)', {
      job: { id: 'job-1', task_identifier: 'x' },
    });
    expect(sink.records[0]!.workerId).toBe('worker-01');
  });

  it('错误对象走安全序列化，不泄漏堆栈', () => {
    const { sink, graphile } = makeGraphileLogger();
    const error = new Error('数据库连接失败');
    graphile.error('Failed task with error', {
      ...JOB_META,
      failure: true,
      error,
    });
    const serialized = JSON.stringify(sink.records);
    expect(serialized).not.toContain('at ');
    expect(sink.records[0]!.error).toBeDefined();
  });

  it('fatal 错误不泄漏 DATABASE_URL', () => {
    const { sink, graphile } = makeGraphileLogger();
    const error = new Error(
      'connect ECONNREFUSED postgresql://educanvas:educanvas@127.0.0.1:5434/educanvas',
    );
    graphile.error('Failed task with error', {
      ...JOB_META,
      failure: true,
      error,
    });
    const serialized = JSON.stringify(sink.records);
    expect(serialized).not.toContain('educanvas:educanvas@');
  });
});
