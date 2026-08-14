import { describe, expect, it } from 'vitest';
import {
  displayWidth,
  padDisplay,
  renderRecord,
  renderSummaryLine,
  truncateDisplay,
} from './pretty-renderer.js';
import type { EduCanvasLogRecord } from './types.js';

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

describe('displayWidth / padDisplay', () => {
  it('中文按宽度 2 计算', () => {
    expect(displayWidth('abc')).toBe(3);
    expect(displayWidth('中文')).toBe(4);
    expect(displayWidth('a中b')).toBe(4);
  });

  it('padDisplay 按显示宽度补齐，中文不破坏对齐', () => {
    expect(padDisplay('WEB', 7)).toBe('WEB    ');
    expect(padDisplay('中文', 6)).toBe('中文  ');
  });
});

describe('truncateDisplay', () => {
  it('按显示宽度截断', () => {
    expect(truncateDisplay('客户端请求完成', 6)).toBe('客户端…');
    expect(truncateDisplay('abc', 10)).toBe('abc');
  });
});

describe('renderRecord', () => {
  it('无颜色时输出固定宽度字段', () => {
    const line = renderRecord(makeRecord(), { color: false });
    expect(line).toContain('WEB');
    expect(line).toContain('INFO');
    expect(line).toContain('gateway.http.completed');
    expect(line).toContain('客户端请求完成');
  });

  it('TTY 模式输出 ANSI 颜色', () => {
    const line = renderRecord(makeRecord({ level: 'error' }), { color: true });
    expect(line).toContain('\x1b[31m');
  });

  it('warn 使用黄色', () => {
    const line = renderRecord(makeRecord({ level: 'warn' }), { color: true });
    expect(line).toContain('\x1b[33m');
  });

  it('非 TTY / NO_COLOR 下无 ANSI', () => {
    const line = renderRecord(makeRecord({ level: 'fatal' }), { color: false });
    expect(line).not.toContain('\x1b[');
  });

  it('成功事件名使用绿色但不依赖颜色', () => {
    const colored = renderRecord(makeRecord({ event: 'service.ready' }), {
      color: true,
    });
    expect(colored).toContain('\x1b[32m');
    const plain = renderRecord(makeRecord({ event: 'service.ready' }), {
      color: false,
    });
    expect(plain).toContain('service.ready');
  });

  it('error 载荷渲染为缩进行', () => {
    const line = renderRecord(
      makeRecord({
        level: 'error',
        error: {
          name: 'Error',
          code: 'DB_UNREACHABLE',
          message: '连接失败',
          retryable: true,
        },
      }),
      { color: false },
    );
    expect(line).toContain('↳');
    expect(line).toContain('连接失败');
    expect(line).toContain('DB_UNREACHABLE');
  });

  it('附加字段按顺序渲染', () => {
    const line = renderRecord(
      makeRecord({
        method: 'POST',
        route: 'client.turns',
        status: 202,
        durationMs: 43,
      }),
      { color: false },
    );
    expect(line).toContain('POST');
    expect(line).toContain('route=client.turns');
    expect(line).toContain('status=202');
    expect(line).toContain('43ms');
  });
});

describe('renderSummaryLine', () => {
  it('成功与失败标记可读', () => {
    const ok = renderSummaryLine('✓', 'Gateway', 'ready', { color: false });
    const fail = renderSummaryLine('✗', 'Worker', 'exited', { color: false });
    expect(ok).toContain('✓');
    expect(fail).toContain('✗');
    expect(ok).not.toContain('\x1b[');
  });

  it('彩色模式成功标记为绿色', () => {
    const line = renderSummaryLine('✓', 'Database', 'ready', { color: true });
    expect(line).toContain('\x1b[32m');
  });
});
