import type { LogSink } from './logger.js';
import type { EduCanvasLogRecord } from './types.js';

/**
 * 测试辅助 — 内存 sink 与记录收集。
 * 仅供测试导入；生产代码不得依赖本模块。
 *
 * LogSink 是函数类型，因此这里提供 `sinkOf()` 把收集器适配成 sink，
 * 避免用 class implements 函数类型（TS 不允许）。
 */

export class MemorySink {
  readonly records: EduCanvasLogRecord[] = [];

  write(record: EduCanvasLogRecord): void {
    this.records.push(record);
  }

  /** 断言式收集：返回按事件名索引的首条记录。 */
  first(event: string): EduCanvasLogRecord | undefined {
    return this.records.find((record) => record.event === event);
  }

  byLevel(level: EduCanvasLogRecord['level']): EduCanvasLogRecord[] {
    return this.records.filter((record) => record.level === level);
  }

  clear(): void {
    this.records.length = 0;
  }
}

/** 序列化收集：验证 JSONL 可解析性时使用。 */
export class StringSink {
  lines: string[] = [];

  write(record: EduCanvasLogRecord): void {
    this.lines.push(JSON.stringify(record));
  }
}

export function sinkOf(sink: MemorySink | StringSink): LogSink {
  return (record) => sink.write(record);
}
