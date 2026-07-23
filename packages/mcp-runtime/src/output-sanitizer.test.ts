import { describe, expect, it } from 'vitest';
import { McpInvocationError, McpRemoteToolError } from './errors';
import { sanitizeMcpToolResult } from './output-sanitizer';

describe('MCP不可信输出净化', () => {
  it('只投影有界文本与结构化JSON并丢弃远端元数据', () => {
    expect(
      sanitizeMcpToolResult({
        content: [
          {
            type: 'text',
            text: 'result',
            annotations: { audience: ['assistant'] },
            _meta: { secret: 'never-project' },
          },
        ],
        structuredContent: { score: 1 },
        _meta: { trace: 'remote' },
      }),
    ).toEqual({
      untrusted: true,
      text: ['result'],
      structuredContent: { score: 1 },
    });
  });

  it('诚实拒绝媒体、远端错误和过大文本', () => {
    const invalid = [
      { content: [{ type: 'image', data: 'a', mimeType: 'image/png' }] },
      { content: [{ type: 'text', text: 'x'.repeat(17 * 1024) }] },
      { content: [], structuredContent: 'not-an-object' },
    ];
    for (const result of invalid) {
      expect(() => sanitizeMcpToolResult(result)).toThrow(McpInvocationError);
    }
    expect(() =>
      sanitizeMcpToolResult({
        content: [{ type: 'text', text: 'private remote detail' }],
        isError: true,
      }),
    ).toThrow(McpRemoteToolError);
  });
});
