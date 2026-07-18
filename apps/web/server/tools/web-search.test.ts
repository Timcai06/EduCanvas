import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { resolveWebSearchTool } = await import('./web-search');

const context = {
  traceId: 't',
  turnId: 'turn',
  subjectId: 'subject',
  conversationId: 'conversation',
};

afterEach(() => {
  delete process.env.SEARCH_API_KEY;
  delete process.env.SEARCH_BASE_URL;
});

describe('resolveWebSearchTool', () => {
  it('未配置 API Key 时返回 null(诚实降级,不注册工具)', () => {
    expect(resolveWebSearchTool()).toBeNull();
  });

  it('映射搜索结果并按护栏截断,Key 不出现在请求 URL', async () => {
    process.env.SEARCH_API_KEY = 'secret-key';
    let capturedUrl = '';
    let capturedBody = '';
    const fetchStub = vi.fn(
      async (url: string | URL | Request, init?: RequestInit) => {
        capturedUrl = String(url);
        capturedBody = String(init?.body);
        return Response.json({
          results: Array.from({ length: 8 }, (_, index) => ({
            title: `结果${index}`,
            url: `https://example.com/${index}`,
            content: 'x'.repeat(900),
          })),
        });
      },
    );

    const tool = resolveWebSearchTool(fetchStub as typeof fetch);
    expect(tool).not.toBeNull();
    const output = (await tool!.handler(
      { query: '神经网络 最新进展' },
      context,
    )) as { results: { snippet: string }[] };

    expect(output.results).toHaveLength(5);
    expect(output.results[0]!.snippet.length).toBeLessThanOrEqual(400);
    expect(capturedUrl).not.toContain('secret-key');
    expect(capturedBody).toContain('secret-key');
    expect(JSON.parse(capturedBody)).toMatchObject({ max_results: 5 });
  });

  it('Provider 非 2xx 以稳定错误抛出', async () => {
    process.env.SEARCH_API_KEY = 'secret-key';
    const tool = resolveWebSearchTool(
      (async () => new Response('err', { status: 429 })) as typeof fetch,
    );
    await expect(tool!.handler({ query: 'x' }, context)).rejects.toThrow(
      'search_provider_429',
    );
  });
});
