import { Logger as GraphileLogger } from 'graphile-worker';
import { redactString, type Logger } from '@educanvas/logging';

/**
 * Graphile Worker → 统一日志协议适配。
 *
 * 安全纪律：
 * - 只采集白名单字段（workerId/taskIdentifier/jobId/attempt/maxAttempts/
 *   durationMs），绝不原样转发任意 Graphile metadata —— `meta.job` 是完整
 *   任务行（含 payload），一次都不能落盘；
 * - message 是 Graphile 英文模板且可能内嵌错误文本，统一经 redactString 清洗；
 * - 高频轮询与框架内部事件映射为 debug，不污染 info 流。
 *
 * 事件映射（稳定机器接口）：
 * - failure/error → `worker.job.failed`（error）
 * - `Completed task` → `worker.job.completed`（info）
 * - 其余框架事件 → `worker.graphile`（debug/warn）
 */

interface GraphileJobMeta {
  job?: {
    id?: unknown;
    task_identifier?: unknown;
    attempts?: unknown;
    max_attempts?: unknown;
  };
  failure?: unknown;
  duration?: unknown;
  error?: unknown;
  [key: string]: unknown;
}

interface GraphileScope {
  label?: string;
  workerId?: string;
  taskIdentifier?: string;
  jobId?: string;
}

const WHITELIST_KEYS = [
  'workerId',
  'taskIdentifier',
  'jobId',
  'attempt',
  'maxAttempts',
  'durationMs',
] as const;

function toSafeInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.round(value)
    : undefined;
}

function pickWhitelist(
  scope: GraphileScope,
  meta: GraphileJobMeta,
): Record<string, unknown> {
  const job = meta.job ?? {};
  const fields: Record<string, unknown> = {};
  if (scope.workerId !== undefined) fields.workerId = scope.workerId;
  if (scope.taskIdentifier !== undefined) {
    fields.taskIdentifier = scope.taskIdentifier;
  } else if (typeof job.task_identifier === 'string') {
    fields.taskIdentifier = job.task_identifier;
  }
  if (scope.jobId !== undefined) {
    fields.jobId = scope.jobId;
  } else if (typeof job.id === 'string') {
    fields.jobId = job.id;
  }
  const attempt = toSafeInteger(job.attempts);
  const maxAttempts = toSafeInteger(job.max_attempts);
  const durationMs = toSafeInteger(meta.duration);
  if (attempt !== undefined) fields.attempt = attempt;
  if (maxAttempts !== undefined) fields.maxAttempts = maxAttempts;
  if (durationMs !== undefined) fields.durationMs = durationMs;
  return fields;
}

/**
 * 构造 graphile-worker 可接受的 Logger 实例。
 * 通过 `LogFunctionFactory` 注入，scope（workerId/taskIdentifier/jobId）由
 * Graphile 按上下文提供，无需依赖任何内部结构。
 */
export function createGraphileLogger(eduLogger: Logger): GraphileLogger {
  return new GraphileLogger((scope: Partial<GraphileScope>) => {
    const normalizedScope: GraphileScope = {
      workerId: scope.workerId,
      taskIdentifier: scope.taskIdentifier,
      jobId: scope.jobId,
      label: scope.label,
    };
    return (level, message, meta) => {
      const fields = pickWhitelist(
        normalizedScope,
        (meta ?? {}) as GraphileJobMeta,
      );
      const safeMessage = redactString(String(message));
      const isFailure =
        level === 'error' ||
        (meta as GraphileJobMeta | undefined)?.failure === true;
      if (isFailure) {
        const error = (meta as GraphileJobMeta | undefined)?.error;
        if (error !== undefined && error !== null) {
          eduLogger.errorWithError(
            'worker.job.failed',
            safeMessage,
            error,
            fields,
          );
        } else {
          eduLogger.error('worker.job.failed', safeMessage, fields);
        }
        return;
      }
      if (/^Completed task/.test(safeMessage)) {
        eduLogger.info('worker.job.completed', safeMessage, fields);
        return;
      }
      if (level === 'warning') {
        eduLogger.warn('service.degraded', safeMessage, fields);
        return;
      }
      // 其余框架事件（轮询、NOTIFY、cron 注册等）统一为低基数 debug 事件。
      eduLogger.debug('worker.graphile', safeMessage, fields);
    };
  });
}

export { WHITELIST_KEYS };
