import { getLogContext, mergeLogContext, type LogContext } from './context.js';
import { redact, redactString } from './redaction.js';
import {
  serializeSafeError,
  safeJsonValue,
  stringifyRecord,
} from './safe-error.js';
import {
  type EduCanvasLogRecord,
  type LogLevel,
  type SafeErrorPayload,
} from './types.js';

/**
 * 统一 Logger — 产生 `educanvas.log.v1` 信封的进程内入口。
 *
 * 纪律：
 * - `event` 必须来自 EVENTS 或等价稳定事件名（机器接口），禁止模糊命名；
 * - `message` 是人类可读中文说明，不含正文/凭据；
 * - 附加字段先经 redact + safeJsonValue 再落盘，防止敏感泄漏与序列化崩溃；
 * - 同一错误只在责任边界记录一次（底层 warn / 应用 error / 进程 fatal）。
 */

export type LogSink = (record: EduCanvasLogRecord) => void;

export interface LoggerOptions {
  service: string;
  component?: string;
  runId?: string;
  sink: LogSink;
  minLevel?: LogLevel;
  now?: () => Date;
}

/** 附加字段：关联 ID 与低基数状态字段，其余自由字段写出前统一脱敏。 */
export interface LogFields {
  requestId?: string;
  operationId?: string;
  traceId?: string;
  jobId?: string;
  workerId?: string;
  conversationId?: string;
  durationMs?: number;
  outcome?: string;
  stream?: 'stdout' | 'stderr';
  [key: string]: unknown;
}

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  fatal: 50,
};

const ANSI_PATTERN = /\x1b\[[0-9;]*[A-Za-z]/g;

export class Logger {
  private readonly service: string;
  private readonly component?: string;
  private readonly runId?: string;
  private readonly sink: LogSink;
  private readonly minLevel: number;
  private readonly now: () => Date;
  private readonly boundContext: LogContext;

  constructor(options: LoggerOptions) {
    this.service = options.service;
    this.component = options.component;
    this.runId = options.runId;
    this.sink = options.sink;
    this.minLevel = LEVEL_ORDER[options.minLevel ?? 'debug'] ?? 10;
    this.now = options.now ?? (() => new Date());
    this.boundContext = {};
  }

  /** 派生同服务下的子 logger（如 component: 'http'）。 */
  child(component: string): Logger {
    return new Logger({
      service: this.service,
      component,
      runId: this.runId,
      sink: this.sink,
      minLevel: this.minLevelName(),
      now: this.now,
    });
  }

  /** 固定关联 ID 的日志作用域；与 AsyncLocalStorage 上下文合并。 */
  withContext(context: Parameters<typeof mergeLogContext>[1]): Logger {
    const derived = Object.create(Object.getPrototypeOf(this)) as Logger;
    Object.assign(derived, this);
    (derived as unknown as { boundContext: LogContext }).boundContext =
      mergeLogContext(this.boundContext, context);
    return derived;
  }

  debug(event: string, message: string, fields: LogFields = {}): void {
    this.write('debug', event, message, fields);
  }

  /** 通用级别出口：供适配层（Graphile/GatewayObservability）按语义选级别。 */
  log(
    level: LogLevel,
    event: string,
    message: string,
    fields: LogFields = {},
  ): void {
    this.write(level, event, message, fields);
  }

  info(event: string, message: string, fields: LogFields = {}): void {
    this.write('info', event, message, fields);
  }

  warn(event: string, message: string, fields: LogFields = {}): void {
    this.write('warn', event, message, fields);
  }

  error(event: string, message: string, fields: LogFields = {}): void {
    this.write('error', event, message, fields);
  }

  fatal(event: string, message: string, fields: LogFields = {}): void {
    this.write('fatal', event, message, fields);
  }

  /** 记录一次错误：error 载荷走安全序列化，不落堆栈与敏感字段。 */
  errorWithError(
    event: string,
    message: string,
    error: unknown,
    fields: LogFields = {},
  ): void {
    this.write('error', event, message, { ...fields, error });
  }

  private minLevelName(): LogLevel {
    const names: LogLevel[] = ['debug', 'info', 'warn', 'error', 'fatal'];
    return names[Math.max(0, this.minLevel / 10 - 1)] ?? 'debug';
  }

  private write(
    level: LogLevel,
    event: string,
    message: string,
    fields: LogFields,
  ): void {
    if ((LEVEL_ORDER[level] ?? 10) < this.minLevel) return;
    const context = mergeLogContext(getLogContext(), this.boundContext);

    const record: EduCanvasLogRecord = {
      schema: 'educanvas.log.v1',
      ts: this.now().toISOString(),
      level,
      service: this.service,
      event,
      message: String(message).replace(ANSI_PATTERN, '').trim(),
      pid: process.pid,
    };
    if (this.component !== undefined) record.component = this.component;
    if (this.runId !== undefined) record.runId = this.runId;

    const rawError: unknown = fields.error;
    const { error: _omitted, ...rest } = fields;
    if (rawError !== undefined) {
      const safeError = serializeSafeError(rawError);
      // error.message 可能内嵌连接串/凭据（如 ECONNREFUSED 详情），统一清洗。
      if (safeError.message !== undefined) {
        safeError.message = redactString(safeError.message);
      }
      record.error = safeError;
    }
    const safeFields = redact(rest);
    if (safeFields !== null && typeof safeFields === 'object') {
      for (const [key, value] of Object.entries(safeFields)) {
        if (value === undefined) continue;
        (record as Record<string, unknown>)[key] = safeJsonValue(value);
      }
    }
    for (const [key, value] of Object.entries(context)) {
      if (value === undefined) continue;
      (record as Record<string, unknown>)[key] ??= value;
    }
    this.emit(record);
  }

  /** 独立出口，便于测试覆写；默认交给 sink。 */
  protected emit(record: EduCanvasLogRecord): void {
    try {
      this.sink(record);
    } catch {
      // sink 失败（磁盘满等）不能拖垮业务进程；降级到 stderr 单行。
      process.stderr.write(`${stringifyRecord(record)}\n`);
    }
  }
}

export type { SafeErrorPayload };
