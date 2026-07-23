import type { TelemetryRuntime } from '@educanvas/telemetry';
import type { TaskList } from 'graphile-worker';
import { loadWorkspaceEnvFiles } from './workspace-env.js';

type TelemetryModule = Pick<
  typeof import('@educanvas/telemetry'),
  'createTelemetryRuntimeFromEnvironment'
>;
type TaskModule = Pick<typeof import('./tasks/index.js'), 'createTaskList'>;

/** Worker启动阶段一次性构造的数据库、任务与遥测依赖。 */
export interface WorkerBootstrap {
  connectionString: string;
  telemetry: TelemetryRuntime;
  taskList: TaskList;
}

/** 环境加载完成前不得求值生产Task Adapter或构造Telemetry Runtime。 */
export async function prepareWorkerBootstrap(
  input: {
    environment?: NodeJS.ProcessEnv;
    loadEnvironment?: (environment: NodeJS.ProcessEnv) => void;
    loadTelemetryModule?: () => Promise<TelemetryModule>;
    loadTaskModule?: () => Promise<TaskModule>;
  } = {},
): Promise<WorkerBootstrap> {
  const environment = input.environment ?? process.env;
  (input.loadEnvironment ?? loadWorkspaceEnvFiles)(environment);
  const connectionString = environment.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL 未设置；worker 必须显式连接数据库');
  }

  const [telemetryModule, taskModule] = await Promise.all([
    (input.loadTelemetryModule ?? (() => import('@educanvas/telemetry')))(),
    (input.loadTaskModule ?? (() => import('./tasks/index.js')))(),
  ]);
  const telemetry = telemetryModule.createTelemetryRuntimeFromEnvironment(
    'educanvas-worker',
    environment,
  );
  try {
    return {
      connectionString,
      telemetry,
      taskList: taskModule.createTaskList({
        continuationTrace: telemetry.continuationTrace,
      }),
    };
  } catch (error) {
    await telemetry.forceFlush().catch(() => undefined);
    await telemetry.shutdown().catch(() => undefined);
    throw error;
  }
}
