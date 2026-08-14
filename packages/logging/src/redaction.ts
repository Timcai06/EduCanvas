import { LOG_LIMITS } from './types.js';

/**
 * 敏感字段递归脱敏 — 日志写出前最后一道边界。
 *
 * 覆盖的键形态：password/passwd/secret/token/api key/authorization/cookie/
 * session/credential/private key/access key 以及 DATABASE_URL 等连接串。
 * 应用在「附加字段对象 + error.message」上；message 本身由调用方保证不写正文。
 */

const SENSITIVE_KEY_PATTERN =
  /(?:password|passwd|secret|token|api[_-]?key|authorization|cookie|session[_-]?(?:id|token)|credential|private[_-]?key|access[_-]?key|client[_-]?secret|database[_-]?url|prompt)/i;

/** 字符串内 `KEY=value` 形态的敏感键值清洗。 */
const KEY_VALUE_PATTERN =
  /([A-Za-z_][A-Za-z0-9_]*(?:_[A-Za-z0-9_]+)*)=([^\s&;,]+)/g;

/** URL 内嵌凭据清洗：`scheme://user:pass@host` → `scheme://[REDACTED]@host`。 */
const URL_CREDENTIAL_PATTERN = /(\/\/)([^/@\s]+)@/g;

export interface RedactOptions {
  maxDepth?: number;
  maxArrayItems?: number;
  maxStringLength?: number;
  /** 返回的脱敏替换文本，默认 `[REDACTED]`。 */
  replacement?: string;
}

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key);
}

/** 字符串级清洗：URL 内嵌凭据 + Authorization header + Bearer token + `KEY=value`。 */
export function redactString(
  input: string,
  replacement = '[REDACTED]',
): string {
  let result = input.replace(URL_CREDENTIAL_PATTERN, `$1${replacement}@`);
  // Authorization 头形态：`Authorization: Bearer xyz` / `Authorization=Bearer xyz` /
  // `Authorization: xyz` 整体替换，避免残留 token 明文。
  result = result.replace(
    /(\b(?:authorization|proxy-authorization)\b\s*[:=]\s*)(?:bearer\s+)?[A-Za-z0-9._~+/=-]+/gi,
    `$1${replacement}`,
  );
  // 无键前缀的独立 Bearer token。
  result = result.replace(
    /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi,
    `Bearer ${replacement}`,
  );
  result = result.replace(KEY_VALUE_PATTERN, (match, key: string) =>
    isSensitiveKey(key) ? `${key}=${replacement}` : match,
  );
  return result;
}

/**
 * 递归脱敏任意值。字符串同时做 URL/键值清洗；键命中敏感模式的值整体替换；
 * 循环引用、深度、长度限制与 safe-error.ts 保持一致策略。
 */
export function redact(value: unknown, options: RedactOptions = {}): unknown {
  const maxDepth = options.maxDepth ?? LOG_LIMITS.maxJsonDepth;
  const maxArrayItems = options.maxArrayItems ?? LOG_LIMITS.maxArrayItems;
  const maxStringLength = options.maxStringLength ?? LOG_LIMITS.maxStringLength;
  const replacement = options.replacement ?? '[REDACTED]';
  const seen = new Set<object>();

  const visit = (current: unknown, depth: number, key?: string): unknown => {
    if (key !== undefined && isSensitiveKey(key)) return replacement;
    if (depth > maxDepth) return '[depth-limited]';
    if (current === null || current === undefined) return current;
    const type = typeof current;
    if (type === 'string') {
      const cleaned = redactString(current as string, replacement);
      return cleaned.length > maxStringLength
        ? `${cleaned.slice(0, maxStringLength)}…[truncated]`
        : cleaned;
    }
    if (type === 'number' || type === 'boolean') return current;
    if (type === 'bigint') return String(current);
    if (type !== 'object') return '[omitted]';

    const object = current as object;
    if (seen.has(object)) return '[circular]';
    seen.add(object);
    try {
      if (Array.isArray(object)) {
        const items = object
          .slice(0, maxArrayItems)
          .map((item, index) => visit(item, depth + 1, String(index)));
        return object.length > maxArrayItems ? [...items, '[…]'] : items;
      }
      if (object instanceof Date) return object.toISOString();
      const entries: Record<string, unknown> = {};
      for (const entryKey of Object.keys(object)) {
        let valueForKey: unknown;
        try {
          valueForKey = (object as Record<string, unknown>)[entryKey];
        } catch {
          valueForKey = '[unreadable]';
        }
        entries[entryKey] = visit(valueForKey, depth + 1, entryKey);
      }
      return entries;
    } finally {
      seen.delete(object);
    }
  };

  return visit(value, 0);
}
