import { describe, expect, it } from 'vitest';
import { JsonlSink } from './json-sink.js';
import { Logger } from './logger.js';
import type { EduCanvasLogRecord } from './types.js';

const record: EduCanvasLogRecord = {
  schema: 'educanvas.log.v1',
  ts: '2026-08-14T18:23:39.102Z',
  level: 'info',
  service: 'worker',
  event: 'worker.ready',
  message: '后台任务 Worker 已就绪',
  pid: 48000,
};

describe('JsonlSink', () => {
  it('每行可独立 JSON.parse', () => {
    const lines: string[] = [];
    const sink = new JsonlSink({ write: (line) => lines.push(line) });
    sink.write(record);
    sink.write({ ...record, level: 'warn', event: 'worker.job.retrying' });
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  it('行内无 ANSI 控制字符', () => {
    const lines: string[] = [];
    const sink = new JsonlSink({ write: (line) => lines.push(line) });
    sink.write({
      ...record,
      message: '\x1b[31m被剥离\x1b[0m',
    });
    expect(lines[0]).not.toContain('\x1b');
  });

  it('超长行被截断但仍可解析', () => {
    const lines: string[] = [];
    const sink = new JsonlSink({
      write: (line) => lines.push(line),
      maxLineLength: 200,
    });
    sink.write({ ...record, message: 'x'.repeat(500) });
    expect(lines[0]!.length).toBeLessThan(300);
    expect(() => JSON.parse(lines[0]!)).not.toThrow();
  });

  it('与 Logger 组合输出合法 JSONL', () => {
    const lines: string[] = [];
    const sink = new JsonlSink({ write: (line) => lines.push(line) });
    const logger = new Logger({
      service: 'gateway',
      sink: (r) => sink.write(r),
    });
    logger.info('service.ready', '网关已就绪', { port: 3200 });
    expect(() => JSON.parse(lines[0]!)).not.toThrow();
    expect(JSON.parse(lines[0]!).port).toBe(3200);
  });
});
