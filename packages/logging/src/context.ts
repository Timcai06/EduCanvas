import { AsyncLocalStorage } from 'node:async_hooks';
import type { CorrelationFields } from './types.js';

/**
 * 关联链上下文传播 — 基于 AsyncLocalStorage，不依赖任何框架。
 *
 * 只传播脱敏后的关联 ID（requestId/operationId/traceId/jobId 等）；
 * OpenTelemetry SDK 类型不进入 logging 公共接口，trace 生命周期仍归
 * telemetry 负责。logging 不替代 operation store 的持久化事实。
 */

export interface LogContext extends CorrelationFields {}

const storage = new AsyncLocalStorage<LogContext>();

/** 在当前异步执行链上运行 fn，日志自动带上传入的关联 ID。 */
export function runWithLogContext<T>(context: LogContext, fn: () => T): T {
  return storage.run(context, fn);
}

/** 读取当前异步链上的关联上下文（无则返回空对象）。 */
export function getLogContext(): LogContext {
  return storage.getStore() ?? {};
}

/** 在既有上下文之上叠加新字段（不覆盖已有值）。 */
export function mergeLogContext(
  base: LogContext,
  extra: LogContext,
): LogContext {
  const merged: LogContext = { ...base };
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined) continue;
    const targetKey = key as keyof LogContext;
    if (merged[targetKey] === undefined) {
      (merged as Record<string, unknown>)[targetKey] = value;
    }
  }
  return merged;
}
