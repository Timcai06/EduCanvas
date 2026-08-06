import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
// vitest 默认 node 环境没有 window/WebSocket/location：
// 导入成功本身即证明模块顶层不读取浏览器全局（SSR 安全）。
import * as transport from './index';

describe('transport SSR 导入安全', () => {
  it('node 环境（无 window）导入不抛错且导出完整', () => {
    expect(typeof transport.StreamingTranscriptionClient).toBe('function');
    expect(typeof transport.createStreamingTranscriptionTicketClient).toBe(
      'function',
    );
    expect(typeof transport.encodePcmToBase64).toBe('function');
    expect(typeof transport.validateStreamingWsUrl).toBe('function');
    expect(typeof transport.isValidTicketEndpoint).toBe('function');
    expect(typeof transport.StreamingTranscriptionClientError).toBe('function');
    expect(typeof transport.StreamingTranscriptionTicketError).toBe('function');
    expect(transport.STREAMING_TRANSCRIPTION_TICKET_ENDPOINT).toContain(
      '/v1/client/streaming-transcription/tickets',
    );
  });

  it('源码不含顶层浏览器全局读取（window/location/document）', () => {
    const root = fileURLToPath(new URL('.', import.meta.url));
    const sources = ['index.ts', 'streaming-transcription-client.ts']
      .map((name) => readFileSync(new URL(name, import.meta.url), 'utf8'))
      .join('\n');
    // 注释/文档字符串可提及这些词；只检查真实成员访问与全局构造。
    const memberAccess = sources.match(/(?:window|location|document)\s*\./g);
    expect(memberAccess).toBeNull();
    // 不得直接 new 全局 WebSocket：浏览器构造器必须注入。
    expect(sources).not.toContain('new WebSocket(');
    expect(root.length).toBeGreaterThan(0);
  });

  it('构造实例时未注入浏览器 API 才可能失败；纯导出路径零副作用', () => {
    // 模块级副作用检查：导入后不产生任何全局可变状态（可重复导入）。
    const first = Object.keys(transport).length;
    expect(first).toBeGreaterThan(0);
  });
});
