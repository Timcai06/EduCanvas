/**
 * 子进程输出管道 — stdout/stderr → 行切分 → 协议解析/legacy 包装。
 *
 * 设计（见统一日志协议 ADR）：
 * - 每个服务由 orchestrator 独立 spawn，服务来源天然确定，无需正则猜测
 *   Turbo/Task 前缀；
 * - 标准 JSON 行（schema=educanvas.log.v1）原样通过（service 字段以进程
 *   绑定为准，防止日志伪造）；无法解析的行包装为 legacy 记录；
 * - 单行不是 JSON 绝不导致崩溃；未换行数据有上限，不无限缓存；
 * - 超长行截断到协议上限。
 */

import { LOG_SCHEMA } from './log-protocol.mjs';
import { sanitizeLegacyLine } from './legacy-sanitize.mjs';

export const MAX_PENDING_CHUNK = 65_536;
export const MAX_LINE_LENGTH = 4_000;

/**
 * 行切分器：chunk 流 → 完整行回调。
 * pending 缓冲超过上限时强制按现有内容切一行（防内存膨胀）。
 */
export function createLineSplitter(onLine) {
  let pending = '';
  return {
    push(chunk) {
      pending += chunk;
      let newlineIndex;
      while ((newlineIndex = pending.indexOf('\n')) !== -1) {
        const line = pending.slice(0, newlineIndex);
        pending = pending.slice(newlineIndex + 1);
        onLine(line.replace(/\r$/, ''));
      }
      if (pending.length > MAX_PENDING_CHUNK) {
        onLine(pending.slice(0, MAX_LINE_LENGTH));
        pending = '';
      }
    },
    end() {
      if (pending !== '') {
        onLine(pending.slice(0, MAX_LINE_LENGTH));
        pending = '';
      }
    },
  };
}

/** 尝试解析标准协议 JSON 行；失败返回 null。 */
export function tryParseLogRecord(line) {
  const trimmed = line.trim();
  if (trimmed === '' || !trimmed.startsWith('{')) return null;
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (
    parsed === null ||
    typeof parsed !== 'object' ||
    parsed.schema !== LOG_SCHEMA ||
    typeof parsed.event !== 'string' ||
    typeof parsed.level !== 'string' ||
    typeof parsed.ts !== 'string'
  ) {
    return null;
  }
  return parsed;
}

/**
 * 把一行进程输出解析为协议记录。
 * service/stream 由调用方注入（进程绑定 + stdout/stderr 来源），
 * 协议行内的 service 字段被忽略（防伪造），其余字段保留。
 */
export function parseProcessLine(line, { service, stream }) {
  const record = tryParseLogRecord(line);
  if (record !== null) {
    return { ...record, service, stream: record.stream ?? stream };
  }
  return {
    schema: LOG_SCHEMA,
    ts: new Date().toISOString(),
    level: stream === 'stderr' ? 'warn' : 'info',
    service,
    component: 'legacy',
    event: 'process.output',
    // legacy 行在写入前统一清洗：strip ANSI → redact 凭据 → 截断，
    // 保证「JSONL 无 ANSI / 安全日志」对所有输出源成立。
    message: sanitizeLegacyLine(line),
    stream,
  };
}
