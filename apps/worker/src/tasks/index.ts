import type { TaskList } from 'graphile-worker';
import { systemHeartbeat } from './system-heartbeat.js';

/**
 * worker 的任务注册表。命名约定 `域.动作`(如后续的 artifact.generate);
 * 任务只能通过本注册表暴露,与 Tool Registry 同样是编译期显式白名单,
 * 不做运行时动态注册。
 */
export const taskList: TaskList = {
  'system.heartbeat': systemHeartbeat,
};
