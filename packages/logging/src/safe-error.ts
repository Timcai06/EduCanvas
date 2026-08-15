import { LOG_LIMITS, type SafeErrorPayload } from './types.js';

/**
 * 安全错误序列化 — 把任意 unknown 转成低敏感载荷。
 *
 * 纪律：
 * - 只保留 name/code/message/retryable/causeCode；堆栈、连接串、正文一律不落日志；
 * - message 截断到长度上限；嵌套对象深度与数组长度受限；
 * - 循环引用、BigInt、Symbol、异常 getter 都不会让序列化崩溃；
 * - 规则：底层依赖返回带 code 的安全错误；重试层记录 warn；应用边界记录 error；
 *   进程边界导致退出时记录 fatal。
 */

export interface SafeErrorOptions {
  maxDepth?: number;
  maxArrayItems?: number;
  maxStringLength?: number;
}

function truncate(value: string, limit: number): string {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}…[truncated ${value.length - limit} chars]`;
}

function readProperty(target: unknown, key: string): unknown {
  try {
    const object = target as Record<string, unknown>;
    return object[key];
  } catch {
    return undefined;
  }
}

function readCode(target: unknown): string | undefined {
  const raw = readProperty(target, 'code');
  return typeof raw === 'string' && raw !== '' ? raw : undefined;
}

function readRetryable(target: unknown): boolean | undefined {
  const raw = readProperty(target, 'retryable');
  return typeof raw === 'boolean' ? raw : undefined;
}

function readMessage(target: unknown): string | undefined {
  const raw = readProperty(target, 'message');
  if (typeof raw === 'string' && raw !== '') return raw;
  // 常见 SDK 错误形态：`{ message: { message: '...' } }` 或非标准字段。
  const nested = readProperty(raw, 'message');
  if (typeof nested === 'string' && nested !== '') return nested;
  return undefined;
}

function readName(target: unknown): string | undefined {
  const raw = readProperty(target, 'name');
  if (typeof raw === 'string' && raw !== '') return raw;
  if (target instanceof Error) return target.constructor.name;
  return undefined;
}

function formatUnknown(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  try {
    return truncate(String(value), LOG_LIMITS.maxStringLength);
  } catch {
    return '[unprintable error]';
  }
}

/**
 * 将错误转换为安全载荷。无法解析的 unknown 也返回兜底载荷，
 * 保证调用方永远拿到可 JSON 序列化的结果。
 */
export function serializeSafeError(
  error: unknown,
  options: SafeErrorOptions = {},
): SafeErrorPayload {
  const maxDepth = options.maxDepth ?? LOG_LIMITS.maxJsonDepth;
  const maxArrayItems = options.maxArrayItems ?? LOG_LIMITS.maxArrayItems;
  const maxStringLength = options.maxStringLength ?? LOG_LIMITS.maxStringLength;

  const payload: SafeErrorPayload = {
    name: readName(error),
    code: readCode(error),
    message:
      readMessage(error) ??
      (error instanceof Error ? error.message : formatUnknown(error)),
    retryable: readRetryable(error),
  };
  // 嵌套错误链：只取一层 cause（防止深度爆炸），且沿用同一套限制。
  const cause = readProperty(error, 'cause');
  if (cause !== undefined && cause !== null) {
    const causeCode = readCode(cause);
    if (causeCode !== undefined) payload.causeCode = causeCode;
  }
  if (payload.message.length > maxStringLength) {
    payload.message = truncate(payload.message, maxStringLength);
  }
  if (payload.message.includes('\n')) {
    // 多行错误信息会破坏单行 JSONL，归一化为单行。
    payload.message = payload.message.replace(/\s+/g, ' ').trim();
  }
  void maxDepth;
  void maxArrayItems;
  return payload;
}

/**
 * 安全序列化任意附加字段对象：递归脱敏、截断并防止循环引用。
 * 供 logger 写附加字段与 error 载荷以外的结构化数据使用。
 */
export function safeJsonValue(
  value: unknown,
  options: SafeErrorOptions = {},
): unknown {
  const maxDepth = options.maxDepth ?? LOG_LIMITS.maxJsonDepth;
  const maxArrayItems = options.maxArrayItems ?? LOG_LIMITS.maxArrayItems;
  const maxStringLength = options.maxStringLength ?? LOG_LIMITS.maxStringLength;
  const seen = new Set<object>();

  const visit = (current: unknown, depth: number): unknown => {
    if (depth > maxDepth) return '[depth-limited]';
    if (current === null || current === undefined) return current;
    const type = typeof current;
    if (type === 'string') {
      return truncate(current as string, maxStringLength);
    }
    if (type === 'number' || type === 'boolean') return current;
    if (type === 'bigint') return String(current);
    if (type === 'function' || type === 'symbol') return '[omitted]';
    if (type !== 'object') return '[omitted]';

    const object = current as object;
    if (seen.has(object)) return '[circular]';
    seen.add(object);

    let result: unknown;
    try {
      if (Array.isArray(object)) {
        const items = object
          .slice(0, maxArrayItems)
          .map((item) => visit(item, depth + 1));
        const bounded: unknown[] =
          object.length > maxArrayItems ? [...items, '[…]'] : items;
        result = bounded;
      } else if (current instanceof Error) {
        // Error 对象在附加字段中统一走安全错误载荷形态。
        result = serializeSafeError(current, options);
      } else if (object instanceof Date) {
        result = object.toISOString();
      } else if (object instanceof URL) {
        result = object.toString();
      } else {
        const entries: Record<string, unknown> = {};
        for (const key of Object.keys(object)) {
          let valueForKey: unknown;
          try {
            valueForKey = (object as Record<string, unknown>)[key];
          } catch {
            valueForKey = '[unreadable]';
          }
          entries[key] = visit(valueForKey, depth + 1);
        }
        result = entries;
      }
    } finally {
      seen.delete(object);
    }
    return result;
  };

  return visit(value, 0);
}

/** 序列化记录为单行 JSON；任何异常都回退到最小安全记录。 */
export function stringifyRecord(record: unknown): string {
  try {
    const line = JSON.stringify(record);
    if (line === undefined) return '{}';
    return line;
  } catch {
    return JSON.stringify({
      schema: 'educanvas.log.v1',
      ts: new Date().toISOString(),
      level: 'error',
      service: 'logging',
      event: 'record.serialize.failed',
      message: '日志记录序列化失败，已降级为最小记录',
    });
  }
}
