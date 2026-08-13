import { describe, expect, it, vi } from 'vitest';
import type {
  ContinuationTracePort,
  MetricsPort,
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
    const metrics: MetricsPort = {
      increment: vi.fn(),
      record: vi.fn(),
      set: vi.fn(),
      snapshot: vi.fn(),
    };
    const telemetry = {
      continuationTrace,
      turnTrace: {} as never,
      metrics,
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
          createTaskList(input: {
            continuationTrace: ContinuationTracePort;
            metrics: MetricsPort;
            terminalReconciliationMode: 'enabled' | 'legacy-disabled';
          }) {
            order.push('tasks.create');
            expect(input.continuationTrace).toBe(continuationTrace);
            expect(input.metrics).toBe(metrics);
            expect(input.terminalReconciliationMode).toBe('enabled');
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

  it('显式legacy-disabled透传到任务构造', async () => {
    const createTaskList = vi.fn(() => ({ noop: async () => {} }));
    const telemetry = {
      continuationTrace: {} as never,
      turnTrace: {} as never,
      metrics: {} as never,
      health: vi.fn(),
      forceFlush: vi.fn(),
      shutdown: vi.fn(),
    };

    await prepareWorkerBootstrap({
      environment: {
        DATABASE_URL: 'postgresql://worker-test',
        EDUCANVAS_GATEWAY_TERMINAL_RECONCILIATION_MODE: 'legacy-disabled',
      },
      loadEnvironment: vi.fn(),
      loadTelemetryModule: async () =>
        ({ createTelemetryRuntimeFromEnvironment: () => telemetry }) as never,
      loadTaskModule: async () => ({ createTaskList }) as never,
    });

    expect(createTaskList).toHaveBeenCalledWith(
      expect.objectContaining({
        terminalReconciliationMode: 'legacy-disabled',
      }),
    );
  });

  it('非法终态收敛模式在构造任务列表前失败且不回显原值', async () => {
    const createTaskList = vi.fn();
    await expect(
      prepareWorkerBootstrap({
        environment: {
          DATABASE_URL: 'postgresql://worker-test',
          EDUCANVAS_GATEWAY_TERMINAL_RECONCILIATION_MODE: 'private-value',
        },
        loadEnvironment: vi.fn(),
        loadTelemetryModule: async () =>
          ({
            createTelemetryRuntimeFromEnvironment: () => ({
              continuationTrace: {} as never,
              turnTrace: {} as never,
              metrics: {} as never,
              health: vi.fn(),
              forceFlush: vi.fn(async () => undefined),
              shutdown: vi.fn(async () => undefined),
            }),
          }) as never,
        loadTaskModule: async () => ({ createTaskList }) as never,
      }),
    ).rejects.toThrow(
      'EDUCANVAS_GATEWAY_TERMINAL_RECONCILIATION_MODE must be enabled or legacy-disabled',
    );
    expect(createTaskList).not.toHaveBeenCalled();
  });
});
