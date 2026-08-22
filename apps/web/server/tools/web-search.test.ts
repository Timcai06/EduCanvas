import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const {
  createWebSearchTool,
  isWebSearchConfigured,
  resolveSearchService,
  resolveWebSearchTool,
} = await import('./web-search');
const { SearchProviderError } = await import('./search-contract');
const { SearchService } = await import('./search-service');
const { SearchProviderRegistry } = await import('./search-registry');
const { ProviderHealthTracker } = await import('./provider-health');

const context = {
  traceId: 't',
  turnId: 'turn',
  subjectId: 'subject',
  conversationId: 'conversation',
};

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.SEARCH_API_KEY;
  delete process.env.SEARCH_BASE_URL;
  delete process.env.SEARXNG_BASE_URL;
  delete process.env.SEARXNG_API_KEY;
});

function createMockProvider(
  name: string,
  results: { title: string; url: string; snippet: string }[],
  options: { delay?: number; error?: Error } = {},
): {
  search: ReturnType<typeof vi.fn>;
  provider: {
    name: string;
    search: (input: {
      query: string;
      limit: number;
    }) => Promise<readonly { title: string; url: string; snippet: string }[]>;
  };
} {
  const search = vi.fn(async () => {
    if (options.delay) await new Promise((r) => setTimeout(r, options.delay));
    if (options.error) throw options.error;
    return results;
  });
  return {
    search,
    provider: { name, search },
  };
}

describe('ProviderHealthTracker', () => {
  it('starts healthy and becomes healthy after cooldown expires', () => {
    let now = 1000;
    const tracker = new ProviderHealthTracker(
      { cooldownMs: 5000, failureThreshold: 2 },
      () => new Date(now),
    );

    expect(tracker.getStatus('p1').status).toBe('healthy');

    tracker.recordFailure('p1');
    expect(tracker.getStatus('p1').status).toBe('healthy');
    expect(tracker.getStatus('p1').consecutiveFailures).toBe(1);

    tracker.recordFailure('p1');
    expect(tracker.getStatus('p1').status).toBe('cooldown');

    now += 6000;
    expect(tracker.getStatus('p1').status).toBe('healthy');
  });

  it('resets on success', () => {
    const tracker = new ProviderHealthTracker({ failureThreshold: 2 });
    tracker.recordFailure('p1');
    tracker.recordFailure('p1');
    expect(tracker.getStatus('p1').status).toBe('cooldown');

    tracker.recordSuccess('p1');
    expect(tracker.getStatus('p1').status).toBe('healthy');
    expect(tracker.getStatus('p1').consecutiveFailures).toBe(0);
  });
});

describe('SearchProviderRegistry', () => {
  it('returns providers in registration order', () => {
    const registry = new SearchProviderRegistry();
    registry.register({ name: 'a', search: vi.fn() });
    registry.register({ name: 'b', search: vi.fn() });
    expect(registry.getProviderNames()).toEqual(['a', 'b']);
  });

  it('skips providers in cooldown', () => {
    const registry = new SearchProviderRegistry({
      healthOptions: { failureThreshold: 1, cooldownMs: 60000 },
    });
    registry.register({ name: 'a', search: vi.fn() });
    registry.register({ name: 'b', search: vi.fn() });

    registry.recordFailure('a');
    expect(registry.getAvailableProviders()).toHaveLength(1);
    expect(registry.getAvailableProviders()[0]!.name).toBe('b');
  });
});

describe('SearchService failover', () => {
  it('uses primary provider on success', async () => {
    const { provider: p1, search: s1 } = createMockProvider(
      'p1',
      Array.from({ length: 5 }, (_, index) => ({
        title: `t-${index}`,
        url: `https://a.com/${index}`,
        snippet: 's',
      })),
    );
    const { provider: p2 } = createMockProvider('p2', []);

    const registry = new SearchProviderRegistry();
    registry.register(p1);
    registry.register(p2);

    const service = new SearchService({ registry });
    const result = await service.search({ query: 'test', limit: 5 });

    expect(result.results).toHaveLength(5);
    expect(result.attemptedProviders).toEqual(['p1']);
    expect(s1).toHaveBeenCalled();
  });

  it('continues to the next provider when the first returns too few candidates', async () => {
    const { provider: p1 } = createMockProvider('p1', [
      { title: 'a', url: 'https://a.com/1', snippet: 's' },
    ]);
    const { provider: p2 } = createMockProvider('p2', [
      { title: 'b', url: 'https://b.com/1', snippet: 's' },
      { title: 'c', url: 'https://c.com/1', snippet: 's' },
    ]);
    const registry = new SearchProviderRegistry();
    registry.register(p1);
    registry.register(p2);
    const service = new SearchService({ registry });

    const output = await service.search({ query: 'test', limit: 3 });

    expect(output.results).toHaveLength(3);
    expect(output.attemptedProviders).toEqual(['p1', 'p2']);
  });

  it('fails over on timeout', async () => {
    const { provider: p1 } = createMockProvider('p1', [], {
      error: new SearchProviderError('search_timeout', true),
    });
    const { provider: p2, search: s2 } = createMockProvider('p2', [
      { title: 't', url: 'https://b.com', snippet: 's' },
    ]);

    const registry = new SearchProviderRegistry();
    registry.register(p1);
    registry.register(p2);

    const service = new SearchService({ registry });
    const result = await service.search({ query: 'test', limit: 5 });

    expect(result.results).toHaveLength(1);
    expect(result.results[0]!.url).toBe('https://b.com');
    expect(result.attemptedProviders).toEqual(['p1', 'p2']);
    expect(s2).toHaveBeenCalled();
  });

  it('fails over on 429', async () => {
    const { provider: p1 } = createMockProvider('p1', [], {
      error: new SearchProviderError('search_rate_limited', true),
    });
    const { provider: p2, search: s2 } = createMockProvider('p2', [
      { title: 't', url: 'https://b.com', snippet: 's' },
    ]);

    const registry = new SearchProviderRegistry();
    registry.register(p1);
    registry.register(p2);

    const service = new SearchService({ registry });
    const result = await service.search({ query: 'test', limit: 5 });

    expect(result.results).toHaveLength(1);
    expect(result.attemptedProviders).toEqual(['p1', 'p2']);
    expect(s2).toHaveBeenCalled();
  });

  it('fails over on 500', async () => {
    const { provider: p1 } = createMockProvider('p1', [], {
      error: new SearchProviderError('search_provider_unavailable', true),
    });
    const { provider: p2, search: s2 } = createMockProvider('p2', [
      { title: 't', url: 'https://b.com', snippet: 's' },
    ]);

    const registry = new SearchProviderRegistry();
    registry.register(p1);
    registry.register(p2);

    const service = new SearchService({ registry });
    const result = await service.search({ query: 'test', limit: 5 });

    expect(result.results).toHaveLength(1);
    expect(result.attemptedProviders).toEqual(['p1', 'p2']);
    expect(s2).toHaveBeenCalled();
  });

  it('does not failover on SSRF/policy failure', async () => {
    const { provider: p1 } = createMockProvider('p1', [], {
      error: new SearchProviderError('search_invalid_response', false),
    });
    const { provider: p2, search: s2 } = createMockProvider('p2', [
      { title: 't', url: 'https://b.com', snippet: 's' },
    ]);

    const registry = new SearchProviderRegistry();
    registry.register(p1);
    registry.register(p2);

    const service = new SearchService({ registry });
    await expect(
      service.search({ query: 'test', limit: 5 }),
    ).rejects.toMatchObject({ code: 'search_invalid_response' });
    expect(s2).not.toHaveBeenCalled();
  });

  it('throws budget exhausted when budget is consumed', async () => {
    const { provider: p1 } = createMockProvider('p1', [], {
      error: new SearchProviderError('search_timeout', true),
    });
    const { provider: p2 } = createMockProvider('p2', [], {
      error: new SearchProviderError('search_timeout', true),
    });

    const registry = new SearchProviderRegistry();
    registry.register(p1);
    registry.register(p2);

    const service = new SearchService({
      registry,
      config: { totalBudgetMs: 1 },
      now: (() => {
        const times = [0, 0, 2];
        return () => new Date(times.shift() ?? 2);
      })(),
    });

    await expect(
      service.search({ query: 'test', limit: 5 }),
    ).rejects.toMatchObject({ code: 'search_budget_exhausted' });
  });

  it('aborts provider I/O when its timeout expires', async () => {
    let providerSignal: AbortSignal | undefined;
    const registry = new SearchProviderRegistry();
    registry.register({
      name: 'slow',
      search: (_request, signal) => {
        providerSignal = signal;
        return new Promise(() => undefined);
      },
    });
    const service = new SearchService({
      registry,
      config: { providerTimeoutMs: 5, totalBudgetMs: 50 },
    });

    await expect(
      service.search({ query: 'test', limit: 5 }),
    ).rejects.toMatchObject({ code: 'search_timeout' });
    expect(providerSignal?.aborted).toBe(true);
  });

  it('distinguishes configured providers in cooldown from no configuration', async () => {
    const registry = new SearchProviderRegistry({
      healthOptions: { failureThreshold: 1 },
    });
    registry.register({ name: 'cooling', search: vi.fn() });
    registry.recordFailure('cooling');
    const service = new SearchService({ registry });

    await expect(
      service.search({ query: 'test', limit: 5 }),
    ).rejects.toMatchObject({ code: 'search_provider_unavailable' });
  });

  it('throws search_not_configured when no providers', async () => {
    const registry = new SearchProviderRegistry();
    const service = new SearchService({ registry });

    await expect(
      service.search({ query: 'test', limit: 5 }),
    ).rejects.toMatchObject({ code: 'search_not_configured' });
  });

  it('respects abort signal', async () => {
    const { provider: p1 } = createMockProvider('p1', [], { delay: 5000 });
    const registry = new SearchProviderRegistry();
    registry.register(p1);

    const service = new SearchService({ registry });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 10);

    await expect(
      service.search({ query: 'test', limit: 5 }, controller.signal),
    ).rejects.toMatchObject({ code: 'search_cancelled' });
  });
});

describe('Tavily adapter', () => {
  it('overfetches up to the provider limit for candidate replacement', async () => {
    let capturedBody = '';
    const { createTavilyAdapter: createAdapter } =
      await import('./tavily-adapter');
    const provider = createAdapter({
      apiKey: 'key',
      fetchImpl: (async (_url, init) => {
        capturedBody = String(init?.body);
        return Response.json({
          results: Array.from({ length: 15 }, (_, index) => ({
            title: `Result ${index}`,
            url: `https://source-${index}.example.com/article`,
            content: 'Summary',
          })),
        });
      }) as typeof fetch,
    });

    const results = await provider.search({ query: 'test', limit: 15 });

    expect(JSON.parse(capturedBody)).toMatchObject({ max_results: 15 });
    expect(results).toHaveLength(15);
  });

  it('normalizes results and filters unsafe URLs', async () => {
    const { createTavilyAdapter: createAdapter } =
      await import('./tavily-adapter');
    const provider = createAdapter({
      apiKey: 'key',
      fetchImpl: (async () =>
        new Response(
          JSON.stringify({
            results: [
              { title: 'ok', url: 'https://example.com/a', content: 'text' },
              { title: 'cred', url: 'https://u:p@example.com/private' },
              { title: 'file', url: 'file:///etc/passwd' },
            ],
          }),
        )) as typeof fetch,
    });

    const results = await provider.search({ query: 'test', limit: 5 });
    expect(results).toHaveLength(1);
    expect(results[0]!.url).toBe('https://example.com/a');
  });

  it('throws rate limited on 429', async () => {
    const { createTavilyAdapter: createAdapter } =
      await import('./tavily-adapter');
    const provider = createAdapter({
      apiKey: 'key',
      fetchImpl: (async () =>
        new Response(null, { status: 429 })) as typeof fetch,
    });

    await expect(
      provider.search({ query: 'test', limit: 5 }),
    ).rejects.toMatchObject({ code: 'search_rate_limited' });
  });

  it('keeps credentials out of the URL and rejects malformed provider data', async () => {
    const { createTavilyAdapter: createAdapter } =
      await import('./tavily-adapter');
    let capturedUrl = '';
    let capturedBody = '';
    const provider = createAdapter({
      apiKey: 'secret-key',
      fetchImpl: vi
        .fn()
        .mockImplementationOnce(
          async (url: string | URL | Request, init?: RequestInit) => {
            capturedUrl = String(url);
            capturedBody = String(init?.body);
            return Response.json({ results: [] });
          },
        )
        .mockResolvedValueOnce(Response.json({ results: [{ url: 42 }] })),
    });

    await provider.search({ query: 'test', limit: 5 });
    expect(capturedUrl).not.toContain('secret-key');
    expect(capturedBody).toContain('secret-key');
    await expect(
      provider.search({ query: 'test', limit: 5 }),
    ).rejects.toMatchObject({ code: 'search_invalid_response' });
  });
});

describe('SearXNG adapter', () => {
  it('isSearXNGConfigured checks env', async () => {
    const { isSearXNGConfigured: check } = await import('./searxng-adapter');
    expect(check({ SEARXNG_BASE_URL: 'http://localhost:8888' })).toBe(true);
    expect(check({})).toBe(false);
    expect(check({ SEARXNG_BASE_URL: '  ' })).toBe(false);
    expect(check({ SEARXNG_BASE_URL: 'file:///tmp/search' })).toBe(false);
    expect(check({ SEARXNG_BASE_URL: 'https://user:pass@example.com' })).toBe(
      false,
    );
  });

  it('maps JSON results and sends an optional key only in headers', async () => {
    const { createSearXNGAdapter: createAdapter } =
      await import('./searxng-adapter');
    let capturedUrl = '';
    let capturedInit: RequestInit | undefined;
    const provider = createAdapter({
      baseUrl: 'https://search.example.test/',
      apiKey: 'searxng-secret',
      fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
        capturedUrl = String(url);
        capturedInit = init;
        return Response.json({
          results: [
            {
              title: 'Result',
              url: 'https://www.example.com/article#section',
              content: 'Summary',
            },
          ],
        });
      }) as typeof fetch,
    });

    const results = await provider.search({ query: 'test', limit: 5 });
    expect(results).toEqual([
      expect.objectContaining({
        title: 'Result',
        url: 'https://www.example.com/article',
        snippet: 'Summary',
        sourceDomain: 'example.com',
      }),
    ]);
    expect(capturedUrl).toContain('/search?q=test&format=json&pageno=1');
    expect(capturedUrl).not.toContain('searxng-secret');
    expect(capturedInit?.headers).toMatchObject({
      Authorization: 'Bearer searxng-secret',
    });
  });
});

describe('resolveWebSearchTool', () => {
  it('returns null when no providers configured', () => {
    expect(resolveWebSearchTool({})).toBeNull();
  });

  it('returns tool when SEARCH_API_KEY is set', () => {
    const tool = resolveWebSearchTool({ SEARCH_API_KEY: 'key' });
    expect(tool).not.toBeNull();
    expect(tool!.name).toBe('webSearch');
  });

  it('rejects invalid provider URLs without breaking ordinary chat', () => {
    expect(
      isWebSearchConfigured({
        SEARCH_API_KEY: 'key',
        SEARCH_BASE_URL: 'file:///tmp/search',
      }),
    ).toBe(false);
    expect(
      resolveWebSearchTool({
        SEARCH_API_KEY: 'key',
        SEARCH_BASE_URL: 'https://user:pass@example.com',
      }),
    ).toBeNull();
  });

  it('fails over from a real Tavily network error to the SearXNG adapter', async () => {
    const fetchStub = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(
        Response.json({
          results: [
            {
              title: 'Backup result',
              url: 'https://example.com/backup',
              content: 'Summary',
            },
          ],
        }),
      );
    const service = resolveSearchService(
      {
        SEARCH_API_KEY: 'tavily-key',
        SEARXNG_BASE_URL: 'https://search.example.test',
      },
      fetchStub as typeof fetch,
    );

    await expect(
      service!.search({ query: 'test', limit: 5 }),
    ).resolves.toMatchObject({
      attemptedProviders: ['tavily', 'searxng'],
      results: [{ title: 'Backup result' }],
    });
  });
});

describe('legacy Tavily compatibility', () => {
  it('preserves the pre-WS02 { results } response shape', async () => {
    const { createTavilySearchProvider } =
      await import('./web-search-provider');
    const provider = createTavilySearchProvider({
      apiKey: 'key',
      fetchImpl: (async () =>
        Response.json({
          results: [
            { title: 'Result', url: 'https://example.com', content: 'Text' },
          ],
        })) as typeof fetch,
    });

    await expect(
      provider.search({ query: 'test', limit: 5 }),
    ).resolves.toMatchObject({ results: [{ title: 'Result' }] });
  });
});

describe('createWebSearchTool budget', () => {
  it('enforces 3 queries and 15 candidates per operation', async () => {
    const provider = {
      name: 'mock',
      search: vi.fn(async ({ query }: { query: string; limit: number }) =>
        Array.from({ length: 5 }, (_, i) => ({
          title: `${query}-${i}`,
          url: `https://example.com/${query}/${i}`,
          snippet: '摘要',
        })),
      ),
    };
    const service = new SearchService({
      registry: (() => {
        const r = new SearchProviderRegistry();
        r.register(provider);
        return r;
      })(),
    });
    const tool = createWebSearchTool(service);

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
  });

  it('does not count failed searches', async () => {
    const provider = {
      name: 'mock',
      search: vi
        .fn()
        .mockRejectedValueOnce(new Error('search_provider_503'))
        .mockResolvedValueOnce([]),
    };
    const service = new SearchService({
      registry: (() => {
        const r = new SearchProviderRegistry();
        r.register(provider);
        return r;
      })(),
    });
    const tool = createWebSearchTool(service);

    await expect(tool.handler({ query: 'gap' }, context)).rejects.toThrow();
    expect(tool.successfulSearchCount).toBe(0);
    await expect(tool.handler({ query: 'gap' }, context)).resolves.toEqual({
      results: [],
    });
    expect(tool.successfulSearchCount).toBe(1);
  });
});
