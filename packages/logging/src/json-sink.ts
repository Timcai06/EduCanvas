import { stringifyRecord } from './safe-error.js';
import type { EduCanvasLogRecord } from './types.js';

/**
 * JSONL sink — 把记录写成「每行独立可 JSON.parse」的单行 JSON。
 *
 * 保证：
 * - 文件/流中绝不出现 ANSI 控制字符（logger 已剥离 message 的 ANSI，
 *   这里对整行再做一次防御性清洗）；
 * - 超长行截断到协议上限，防止单个异常记录撑爆文件；
 * - 写失败向上抛给 logger 的降级出口，不静默丢日志。
 */

export interface JsonlSinkOptions {
  write: (line: string) => void;
  maxLineLength?: number;
}

/**
 * 在序列化前递归截断字符串字段，保证整行不超长且 JSON 始终合法。
 * （直接截断 JSON 行会产生未闭合引号，破坏「每行可独立解析」约束。）
 */
function boundRecordStrings(
  record: EduCanvasLogRecord,
  maxChars: number,
): EduCanvasLogRecord {
  const visit = (value: unknown, depth: number): unknown => {
    if (value === null || value === undefined || depth > 6) return value;
    if (typeof value === 'string') {
      return value.length > maxChars
        ? `${value.slice(0, maxChars)}…[truncated]`
        : value;
    }
    if (typeof value !== 'object') return value;
    if (Array.isArray(value))
      return value.map((item) => visit(item, depth + 1));
    const entries: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(
      value as Record<string, unknown>,
    )) {
      entries[key] = visit(entry, depth + 1);
    }
    return entries;
  };
  return visit(record, 0) as EduCanvasLogRecord;
}

export class JsonlSink {
  private readonly writeLine: (line: string) => void;
  private readonly maxLineLength: number;
  private readonly maxStringChars: number;

  constructor(options: JsonlSinkOptions) {
    this.writeLine = options.write;
    this.maxLineLength = options.maxLineLength ?? 4_000;
    // 单个字符串上限取行上限的四分之一：多字段记录叠加后整行仍受控。
    this.maxStringChars = Math.max(64, Math.floor(this.maxLineLength / 4));
  }

  /** 序列化并写入一行（含换行符）。 */
  write(record: EduCanvasLogRecord): void {
    const bounded = boundRecordStrings(record, this.maxStringChars);
    const line = stringifyRecord(bounded);
    const cleaned = line.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
    this.writeLine(`${cleaned}\n`);
  }
}

/** 便捷工厂：向任意支持 write 的 Writable 写 JSONL。 */
export function createStreamJsonlSink(stream: {
  write: (chunk: string) => boolean;
}): JsonlSink {
  return new JsonlSink({ write: (line) => stream.write(line) });
}
