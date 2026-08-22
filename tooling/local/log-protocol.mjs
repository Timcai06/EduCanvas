/**
 * 日志协议常量 — packages/logging 与 tooling 共享的单一事实源。
 * Node 24 ESM JSON import；tooling（.mjs）不依赖 TS 运行时。
 */

import protocol from '../../packages/logging/protocol.json' with { type: 'json' };

export const LOG_SCHEMA = protocol.schema;
export const LOG_LEVELS = protocol.levels;
export const LOCAL_RUN_SCHEMA = protocol.runSchema;
export const LOG_LIMITS = protocol.limits;

/** 统一事件名（与 packages/logging/src/types.ts 的 EVENTS 保持一致）。 */
export const EVENTS = {
  runtimeStarting: 'runtime.starting',
  runtimeReady: 'runtime.ready',
  runtimeStopping: 'runtime.stopping',
  runtimeStopped: 'runtime.stopped',
  runtimeFailed: 'runtime.failed',
  environmentChecked: 'environment.checked',
  databaseStarting: 'database.starting',
  databaseReady: 'database.ready',
  databaseFailed: 'database.failed',
  migrationStarted: 'migration.started',
  migrationCompleted: 'migration.completed',
  migrationSkipped: 'migration.skipped',
  migrationFailed: 'migration.failed',
  serviceStarting: 'service.starting',
  serviceReady: 'service.ready',
  serviceStopping: 'service.stopping',
  serviceStopped: 'service.stopped',
  serviceDegraded: 'service.degraded',
  serviceFailed: 'service.failed',
  gatewayHttpCompleted: 'gateway.http.completed',
  gatewayOperationTransitioned: 'gateway.operation.transitioned',
  gatewayWebsocketOpened: 'gateway.websocket.opened',
  gatewayWebsocketClosed: 'gateway.websocket.closed',
  workerReady: 'worker.ready',
  workerJobStarted: 'worker.job.started',
  workerJobCompleted: 'worker.job.completed',
  workerJobRetrying: 'worker.job.retrying',
  workerJobFailed: 'worker.job.failed',
  processOutput: 'process.output',
};
