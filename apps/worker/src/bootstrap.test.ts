import { describe, expect, it, vi } from 'vitest';
import type {
  ContinuationTracePort,
  TelemetryEnvironment,
} from '@educanvas/telemetry';
import { prepareWorkerBootstrap } from './bootstrap';

describe('worker bootstrap ordering', () => {
  it('先加载workspace env，再加载模块并构造telemetry与task list', async () => {
    const order: string[] = [];
    const environment: NodeJS.ProcessEnv = {};
    const continuationTrace = {
      run<T>(_input: unknown, callback: () => Promise<T>) {
        return callback();
      },
    };
    const telemetry = {
      continuationTrace,
      turnTrace: {} as never,
      health: vi.fn(),
      forceFlush: vi.fn(),
      shutdown: vi.fn(),
    };
    const taskList = { noop: async () => {} };

    const result = await prepareWorkerBootstrap({
      environment,
      loadEnvironment(target) {
        order.push('environment');
        target.DATABASE_URL = 'postgresql://worker-test';
        target.EDUCANVAS_OTEL_ENABLED = 'false';
      },
      async loadTelemetryModule() {
        order.push('telemetry.module');
        return {
          createTelemetryRuntimeFromEnvironment(
            serviceName: string,
            received: TelemetryEnvironment,
          ) {
            order.push('telemetry.runtime');
            expect(serviceName).toBe('educanvas-worker');
            expect(received).toBe(environment);
            return telemetry;
          },
        } as never;
      },
      async loadTaskModule() {
        order.push('tasks.module');
        return {
          createTaskList(input: { continuationTrace: ContinuationTracePort }) {
            order.push('tasks.create');
            expect(input.continuationTrace).toBe(continuationTrace);
            return taskList;
          },
        } as never;
      },
    });

    expect(order).toEqual([
      'environment',
      'telemetry.module',
      'tasks.module',
      'telemetry.runtime',
      'tasks.create',
    ]);
    expect(result).toEqual({
      connectionString: 'postgresql://worker-test',
      telemetry,
      taskList,
    });
  });

  it('缺少DATABASE_URL时不会加载生产模块', async () => {
    const loadTelemetryModule = vi.fn();
    const loadTaskModule = vi.fn();

    await expect(
      prepareWorkerBootstrap({
        environment: {},
        loadEnvironment: vi.fn(),
        loadTelemetryModule,
        loadTaskModule,
      }),
    ).rejects.toThrow('DATABASE_URL 未设置');
    expect(loadTelemetryModule).not.toHaveBeenCalled();
    expect(loadTaskModule).not.toHaveBeenCalled();
  });
});
