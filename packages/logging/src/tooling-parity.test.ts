import { describe, expect, it } from 'vitest';
import {
  renderRecord as tsRenderRecord,
  renderSummaryLine as tsRenderSummaryLine,
} from './pretty-renderer.js';
import { redactString } from './redaction.js';
import type { EduCanvasLogRecord } from './types.js';
import {
  renderRecord as mjsRenderRecord,
  renderSummaryLine as mjsRenderSummaryLine,
} from '../../../tooling/local-pretty.mjs';
import {
  redactLegacyString,
  sanitizeLegacyLine,
  stripAnsi,
} from '../../../tooling/legacy-sanitize.mjs';

/**
 * tooling（.mjs）与 packages/logging（TS）双份渲染/脱敏实现的契约测试。
 *
 * 背景（统一日志协议 ADR）：tooling 不能直接 import TS，因此维护一个
 * runtime 实现。契约测试锁定两边的输出等价性，防止日常改动产生漂移。
 */

const TEST_ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;
const stripAnsiInTest = (text: string) => text.replace(TEST_ANSI, '');

function makeRecord(
  overrides: Partial<EduCanvasLogRecord> = {},
): EduCanvasLogRecord {
  return {
    schema: 'educanvas.log.v1',
    ts: '2026-08-14T11:26:04.112Z',
    level: 'info',
    service: 'web',
    event: 'gateway.http.completed',
    message: '客户端请求完成',
    ...overrides,
  };
}

const RECORD_CORPUS: EduCanvasLogRecord[] = [
  makeRecord(),
  makeRecord({
    level: 'warn',
    event: 'worker.job.retrying',
    message: '任务重试',
  }),
  makeRecord({
    level: 'error',
    event: 'worker.job.failed',
    message: '任务失败',
    error: {
      name: 'Error',
      code: 'DB_UNREACHABLE',
      message: '连接失败',
      retryable: true,
    },
  }),
  makeRecord({
    service: 'gateway',
    level: 'debug',
    event: 'gateway.websocket.opened',
    message: '会话已打开',
    operationId: 'op-7a31c2',
    traceId: 'trace-1',
    method: 'POST',
    route: 'client.turns',
    status: 202,
    durationMs: 43,
  }),
  makeRecord({ service: 'worker', event: 'worker.ready', message: '就绪' }),
  makeRecord({
    service: '中文服务',
    level: 'info',
    event: 'service.started',
    message: '中文宽度对齐检查',
  }),
];

describe('renderer parity（TS vs tooling .mjs）', () => {
  for (const [index, record] of RECORD_CORPUS.entries()) {
    it(`record #${index} 无颜色输出一致`, () => {
      const ts = tsRenderRecord(record, { color: false });
      const mjs = mjsRenderRecord(record, { color: false });
      expect(ts).toBe(mjs);
    });

    it(`record #${index} 彩色输出剥离 ANSI 后一致`, () => {
      const ts = tsRenderRecord(record, { color: true });
      const mjs = mjsRenderRecord(record, { color: true });
      expect(stripAnsiInTest(ts)).toBe(stripAnsiInTest(mjs));
    });
  }

  it('renderSummaryLine 输出一致', () => {
    for (const symbol of ['✓', '✗']) {
      const ts = tsRenderSummaryLine(symbol, 'Database', 'ready', {
        color: false,
      });
      const mjs = mjsRenderSummaryLine(symbol, 'Database', 'ready', {
        color: false,
      });
      expect(ts).toBe(mjs);
    }
  });
});

describe('legacy sanitizer parity（TS redactString vs tooling）', () => {
  const SANITIZE_CORPUS = [
    'plain legacy text',
    'Authorization: Bearer sk-abc12345',
    'DATABASE_URL=postgresql://educanvas:secret@127.0.0.1:5434/educanvas',
    'fetching https://user:pass@example.com/api',
    // 低熵占位值：字段名驱动脱敏（api_key=test → api_key=[REDACTED]），
    // 同时避免 gitleaks generic-api-key 将 fixture 误报为真实凭据。
    'api_key=test token=test',
    'Compiled successfully in 1.2s',
    'POST /api/turns 200 43ms operationId=op-7a31c2',
  ];

  it('无 ANSI 输入：sanitizeLegacyLine 与 redactString 等价', () => {
    for (const line of SANITIZE_CORPUS) {
      expect(sanitizeLegacyLine(line), line).toBe(redactString(line));
    }
  });

  it('含 ANSI 输入：先剥离后脱敏，顺序与结果与 TS 侧一致', () => {
    const colored = [
      '\x1b[32mready\x1b[0m',
      '\x1b[31mBearer sk-abc12345\x1b[0m',
    ];
    for (const line of colored) {
      expect(sanitizeLegacyLine(line), line).toBe(
        redactString(stripAnsiInTest(line)),
      );
      expect(sanitizeLegacyLine(line)).not.toContain('\x1b[');
    }
  });

  it('redactLegacyString 与 redactString 对同一输入等价', () => {
    for (const line of SANITIZE_CORPUS) {
      expect(redactLegacyString(line), line).toBe(redactString(line));
    }
  });

  it('stripAnsi 与测试侧正则行为一致（防误伤普通文本）', () => {
    expect(stripAnsi('plain text without escapes')).toBe(
      'plain text without escapes',
    );
    expect(stripAnsi('\x1b[2m dim \x1b[0m')).toBe(' dim ');
  });
});
