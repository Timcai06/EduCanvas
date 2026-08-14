import protocol from '../protocol.json' with { type: 'json' };

/**
 * 统一日志协议（`educanvas.log.v1`）的类型定义与常量。
 *
 * 协议约束（见 docs/09-decisions/ 对应 ADR）：
 * - `event` 是稳定机器接口，低基数；`message` 是人类可读内容，两者分离；
 * - 时间统一 ISO 8601 UTC；duration 统一毫秒；
 * - service/event/level 必须低基数且稳定，禁止模糊事件名；
 * - 所有附加字段必须经过脱敏与长度/深度限制（见 redaction.ts / safe-error.ts）。
 */

export const LOG_LEVELS = [...protocol.levels] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export const LOG_SCHEMA = protocol.schema;
export const LOCAL_RUN_SCHEMA = protocol.runSchema;
export const LOG_LIMITS = protocol.limits;

/** 安全错误载荷：只含低敏感字段，绝不含堆栈、连接串或正文。 */
export interface SafeErrorPayload {
  name?: string;
  code?: string;
  message: string;
  retryable?: boolean;
  causeCode?: string;
}

/**
 * 统一日志信封。索引签名允许低基数附加字段（method/route/status 等），
 * 序列化前必须经过脱敏与深度/长度限制。
 */
export interface EduCanvasLogRecord {
  schema: typeof LOG_SCHEMA;
  ts: string;
  level: LogLevel;
  service: string;
  component?: string;
  event: string;
  message: string;
  runId?: string;
  pid?: number;
  stream?: 'stdout' | 'stderr';
  requestId?: string;
  operationId?: string;
  traceId?: string;
  jobId?: string;
  workerId?: string;
  conversationId?: string;
  durationMs?: number;
  outcome?: string;
  error?: SafeErrorPayload;
  [key: string]: unknown;
}

/** 运行时会话元数据（写入 run.json）。 */
export interface LocalRunMeta {
  schema: typeof LOCAL_RUN_SCHEMA;
  runId: string;
  startedAt: string;
  orchestratorPid: number;
  webUrl?: string;
  gatewayUrl?: string;
  state: 'starting' | 'running' | 'stopped' | 'failed';
  stoppedAt?: string;
  exitReason?: string;
}

/** 关联链字段：不强制每条日志携带全部 ID。 */
export type CorrelationFields = Pick<
  EduCanvasLogRecord,
  | 'requestId'
  | 'operationId'
  | 'traceId'
  | 'jobId'
  | 'workerId'
  | 'conversationId'
>;

/** 统一事件名（推荐集，见 ADR）。 */
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
} as const;

export type LogEvent = (typeof EVENTS)[keyof typeof EVENTS];
