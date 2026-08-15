/**
 * legacy 进程输出清洗 — 写入 JSONL 前的最后一道边界。
 *
 * 与 packages/logging/src/redaction.ts 的 redactString 保持同一套正则契约
 * （tooling 不能直接 import TS，见统一日志协议 ADR）；差异由
 * packages/logging/src/tooling-parity.test.ts 的契约测试锁定。
 *
 * 顺序：strip ANSI → URL 内嵌凭据 → Authorization/Bearer → KEY=value →
 * 截断。保证「JSONL 无 ANSI、无凭据」对所有输出源成立，而不仅是标准
 * Gateway/Worker 协议日志。
 */

const ANSI_PATTERN = /\x1b\[[0-9;]*[A-Za-z]/g;

const SENSITIVE_KEY_PATTERN =
  /(?:password|passwd|secret|token|api[_-]?key|authorization|cookie|session[_-]?(?:id|token)|credential|private[_-]?key|access[_-]?key|client[_-]?secret|database[_-]?url|prompt)/i;

/** 字符串内 `KEY=value` 形态的敏感键值清洗。 */
const KEY_VALUE_PATTERN =
  /([A-Za-z_][A-Za-z0-9_]*(?:_[A-Za-z0-9_]+)*)=([^\s&;,]+)/g;

/** URL 内嵌凭据清洗：`scheme://user:pass@host` → `scheme://[REDACTED]@host`。 */
const URL_CREDENTIAL_PATTERN = /(\/\/)([^/@\s]+)@/g;

/** 与 local-process-pipe.mjs 的 MAX_LINE_LENGTH 保持一致。 */
export const DEFAULT_LEGACY_MAX_LENGTH = 4_000;

/** 剥离 ANSI 转义序列（SGR 颜色等）。 */
export function stripAnsi(text) {
  return text.replace(ANSI_PATTERN, '');
}

/** 字符串级脱敏，镜像 packages/logging redactString 的契约。 */
export function redactLegacyString(input, replacement = '[REDACTED]') {
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
  result = result.replace(KEY_VALUE_PATTERN, (match, key) =>
    SENSITIVE_KEY_PATTERN.test(key) ? `${key}=${replacement}` : match,
  );
  return result;
}

/** legacy 行统一清洗：strip ANSI → redact → 截断。 */
export function sanitizeLegacyLine(
  line,
  maxLength = DEFAULT_LEGACY_MAX_LENGTH,
) {
  return redactLegacyString(stripAnsi(line)).slice(0, maxLength);
}
