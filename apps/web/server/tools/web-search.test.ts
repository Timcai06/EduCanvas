import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { createWebSearchTool, isWebSearchConfigured, resolveWebSearchTool } =
  await import('./web-search');
const { createTavilySearchProvider } = await import('./web-search-provider');

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
  it('只有服务端配置搜索凭据时才开放深度研究', () => {
    expect(isWebSearchConfigured({ SEARCH_API_KEY: ' key ' })).toBe(true);
    expect(isWebSearchConfigured({ SEARCH_API_KEY: ' ' })).toBe(false);
    expect(isWebSearchConfigured({})).toBe(false);
  });

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

  it('Provider 严格验证响应并过滤不安全 URL', async () => {
    const provider = createTavilySearchProvider({
      apiKey: 'secret-key',
      fetchImpl: (async () =>
        Response.json({
          results: [
            { title: '公开', url: 'https://example.com/a#part', content: 'ok' },
            { title: '带凭据', url: 'https://u:p@example.com/private' },
            { title: '非网页', url: 'file:///etc/passwd' },
          ],
        })) as typeof fetch,
    });

    await expect(provider.search({ query: 'test', limit: 5 })).resolves.toEqual(
      {
        results: [
          { title: '公开', url: 'https://example.com/a', snippet: 'ok' },
        ],
      },
    );
  });

  it('每个 Operation 最多执行 3 个不同查询、累计返回 15 个去重候选', async () => {
    const provider = {
      search: vi.fn(async ({ query }: { query: string; limit: number }) => ({
        results: Array.from({ length: 5 }, (_, index) => ({
          title: `${query}-${index}`,
          url: `https://example.com/${query}/${index}`,
          snippet: '摘要',
        })),
      })),
    };
    const tool = createWebSearchTool(provider);

    await tool.handler({ query: ' broad ' }, context);
    await tool.handler({ query: 'gap' }, context);
    await tool.handler({ query: 'deep' }, context);
    expect(tool.successfulSearchCount).toBe(3);
    await expect(tool.handler({ query: 'fourth' }, context)).rejects.toThrow(
      'search_budget_exceeded',
    );
    await expect(tool.handler({ query: 'BROAD' }, context)).rejects.toThrow(
      'search_query_duplicate',
    );
    expect(provider.search).toHaveBeenCalledTimes(3);
  });

  it('Provider 失败不计为有效搜索并允许同一查询重试', async () => {
    const provider = {
      search: vi
        .fn()
        .mockRejectedValueOnce(new Error('search_provider_503'))
        .mockResolvedValueOnce({ results: [] }),
    };
    const tool = createWebSearchTool(provider);

    await expect(tool.handler({ query: 'gap' }, context)).rejects.toThrow(
      'search_provider_503',
    );
    expect(tool.successfulSearchCount).toBe(0);
    await expect(tool.handler({ query: 'gap' }, context)).resolves.toEqual({
      results: [],
    });
    expect(tool.successfulSearchCount).toBe(1);
  });
});
