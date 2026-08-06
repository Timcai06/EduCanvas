import { describe, expect, it } from 'vitest';
import { MetricsRegistry } from '@educanvas/telemetry';
import { withTaskMetrics } from './index';

/** graphile-worker 的 helpers 只取 job.attempts，其余字段测试不关心。 */
const helpers = (attempts: number) =>
  ({
    job: { attempts },
    logger: { info: () => {} },
  }) as never;

describe('withTaskMetrics（Q04 Worker SLI）', () => {
  it('指标实现抛错不改变任务成功结果', async () => {
    let completed = false;
    const wrapped = withTaskMetrics({
      increment() {
        throw new Error('metrics unavailable');
      },
      record() {},
      set() {},
      snapshot: () => ({ counters: {}, histograms: {}, gauges: {} }),
    })('test:task', async () => {
      completed = true;
    });
    await expect(wrapped({}, helpers(2))).resolves.toBeUndefined();
    expect(completed).toBe(true);
  });

  it('指标实现抛错不覆盖任务原始失败', async () => {
    const wrapped = withTaskMetrics({
      increment() {
        throw new Error('metrics unavailable');
      },
      record() {},
      set() {},
      snapshot: () => ({ counters: {}, histograms: {}, gauges: {} }),
    })('test:task', async () => {
      throw new Error('business failure');
    });
    await expect(wrapped({}, helpers(1))).rejects.toThrow('business failure');
  });

  it('成功任务记录 worker_task_total{task,status=success}', async () => {
    const registry = new MetricsRegistry();
    const wrapped = withTaskMetrics(registry)('test:task', async () => {});
    await wrapped({}, helpers(1));
    expect(
      registry.snapshot().counters[
        'worker_task_total{status=success,task=test:task}'
      ],
    ).toBe(1);
  });

  it('失败任务记录 status=failed 并原样抛错', async () => {
    const registry = new MetricsRegistry();
    const wrapped = withTaskMetrics(registry)('test:task', async () => {
      throw new Error('boom');
    });
    await expect(wrapped({}, helpers(1))).rejects.toThrow('boom');
    expect(
      registry.snapshot().counters[
        'worker_task_total{status=failed,task=test:task}'
      ],
    ).toBe(1);
  });

  it('重试执行（attempts>1）额外记录重试计数，不影响结果计数', async () => {
    const registry = new MetricsRegistry();
    const wrapped = withTaskMetrics(registry)('test:task', async () => {});
    await wrapped({}, helpers(2));
    const counters = registry.snapshot().counters;
    expect(counters['worker_task_retry_total{task=test:task}']).toBe(1);
    expect(counters['worker_task_total{status=success,task=test:task}']).toBe(
      1,
    );
  });

  it('任务名不符合低基数标签格式时在注册期抛错（不污染任务结果）', () => {
    const registry = new MetricsRegistry();
    expect(() =>
      withTaskMetrics(registry)('bad/task name', async () => {}),
    ).toThrow();
    expect(registry.snapshot().counters).toEqual({});
  });
});
