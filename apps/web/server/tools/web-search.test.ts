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
const { MetricsRegistry } = await import('@educanvas/telemetry');
const { createFetchWebPageTool } = await import('./web-page');
const { SEARCH_PROVIDER_TIMEOUT_MS, WEB_SEARCH_TOOL_TIMEOUT_MS } =
  await import('./search-budgets');

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
  it('records only closed provider labels and never query or URL values', async () => {
    const { provider } = createMockProvider('tenant-provider-name', [
      { title: 'result', url: 'https://secret.example/path', snippet: 'body' },
    ]);
    const registry = new SearchProviderRegistry();
    registry.register(provider);
    const metrics = new MetricsRegistry();

    await new SearchService({ registry, metrics }).search({
      query: 'private query text',
      limit: 1,
    });

    const serialized = JSON.stringify(metrics.snapshot());
    expect(serialized).toContain(
      'web_search_provider_attempts_total{outcome=success,provider=unknown}',
    );
    expect(serialized).not.toContain('private query text');
    expect(serialized).not.toContain('secret.example');
    expect(serialized).not.toContain('tenant-provider-name');
  });

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
  it('keeps the default provider window open beyond the former eight-second cutoff', async () => {
    vi.useFakeTimers();
    try {
      const { createTavilyAdapter: createAdapter } =
        await import('./tavily-adapter');
      const provider = createAdapter({
        apiKey: 'key',
        fetchImpl: vi.fn(
          async (_url: string | URL | Request, init?: RequestInit) =>
            await new Promise<Response>((resolve, reject) => {
              const timer = setTimeout(
                () =>
                  resolve(
                    Response.json({
                      results: [
                        {
                          title: 'Result',
                          url: 'https://example.com/article',
                          content: 'Summary',
                        },
                      ],
                    }),
                  ),
                9_000,
              );
              init?.signal?.addEventListener(
                'abort',
                () => {
                  clearTimeout(timer);
                  reject(new DOMException('Aborted', 'AbortError'));
                },
                { once: true },
              );
            }),
        ) as typeof fetch,
      });

      const registry = new SearchProviderRegistry();
      registry.register(provider);
      const service = new SearchService({ registry });
      const pending = service.search({ query: 'test', limit: 1 });
      await vi.advanceTimersByTimeAsync(9_000);

      await expect(pending).resolves.toMatchObject({
        results: [{ url: 'https://example.com/article' }],
      });
      expect(SEARCH_PROVIDER_TIMEOUT_MS).toBeGreaterThan(9_000);
    } finally {
      vi.useRealTimers();
    }
  });

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

  it('clips provider display fields while retaining bounded response safety', async () => {
    const { createTavilyAdapter: createAdapter } =
      await import('./tavily-adapter');
    const oversized = new Response(
      JSON.stringify({
        results: [
          {
            title: 'x'.repeat(201),
            url: 'https://example.com/article',
            content: 'y'.repeat(1_493),
          },
        ],
      }),
    );
    const json = vi.spyOn(oversized, 'json');
    const provider = createAdapter({
      apiKey: 'key',
      fetchImpl: (async () => oversized) as typeof fetch,
    });

    const results = await provider.search({ query: 'test', limit: 5 });
    expect(results).toHaveLength(1);
    expect(results[0]?.title).toHaveLength(200);
    expect(results[0]?.title.endsWith('…')).toBe(true);
    expect(results[0]?.snippet).toHaveLength(400);
    expect(results[0]?.snippet.endsWith('…')).toBe(true);
    expect(json).not.toHaveBeenCalled();

    const longUrlProvider = createAdapter({
      apiKey: 'key',
      fetchImpl: (async () =>
        Response.json({
          results: [
            {
              title: 'safe',
              url: `https://example.com/${'x'.repeat(1_024)}`,
              content: 'safe',
            },
          ],
        })) as typeof fetch,
    });
    await expect(
      longUrlProvider.search({ query: 'test', limit: 5 }),
    ).rejects.toMatchObject({ code: 'search_invalid_response' });

    const huge = new Uint8Array(256 * 1024 + 1);
    huge.fill(65);
    const hugeProvider = createAdapter({
      apiKey: 'key',
      fetchImpl: (async () => new Response(huge)) as typeof fetch,
    });
    await expect(
      hugeProvider.search({ query: 'test', limit: 5 }),
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

  it('clips display fields and rejects excessive result counts and payloads', async () => {
    const { createSearXNGAdapter: createAdapter } =
      await import('./searxng-adapter');
    const oversized = new Response(
      JSON.stringify({
        results: [
          {
            title: 't'.repeat(201),
            url: 'https://example.com/article',
            content: 'x'.repeat(1_493),
          },
        ],
      }),
    );
    const provider = createAdapter({
      baseUrl: 'https://search.example.test',
      fetchImpl: (async () => oversized) as typeof fetch,
    });

    const results = await provider.search({ query: 'test', limit: 5 });
    expect(results).toHaveLength(1);
    expect(results[0]?.title).toHaveLength(200);
    expect(results[0]?.title.endsWith('…')).toBe(true);
    expect(results[0]?.snippet).toHaveLength(400);
    expect(results[0]?.snippet.endsWith('…')).toBe(true);

    const tooMany = new Response(
      JSON.stringify({
        results: Array.from({ length: 21 }, (_, index) => ({
          title: `Result ${index}`,
          url: `https://example.com/${index}`,
          content: 'safe',
        })),
      }),
    );
    const tooManyProvider = createAdapter({
      baseUrl: 'https://search.example.test',
      fetchImpl: (async () => tooMany) as typeof fetch,
    });
    await expect(
      tooManyProvider.search({ query: 'test', limit: 50 }),
    ).rejects.toMatchObject({ code: 'search_invalid_response' });

    const huge = new Uint8Array(256 * 1024 + 1);
    huge.fill(65);
    const hugeProvider = createAdapter({
      baseUrl: 'https://search.example.test',
      fetchImpl: (async () => new Response(huge)) as typeof fetch,
    });
    await expect(
      hugeProvider.search({ query: 'test', limit: 5 }),
    ).rejects.toMatchObject({ code: 'search_invalid_response' });
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

describe('Agent web traffic boundary', () => {
  it('shares the Notebook concurrency wall across search and page reads', async () => {
    const resolvers: Array<(value: { results: readonly never[] }) => void> = [];
    const service = {
      search: vi.fn(
        () =>
          new Promise<{ results: readonly never[] }>((resolve) => {
            resolvers.push(resolve);
          }),
      ),
    };
    const trafficKey = 'agent-subject\u0000agent-notebook-concurrency-test';
    const searches = Array.from({ length: 3 }, () =>
      createWebSearchTool(service, { trafficKey }),
    );
    const pending = searches.map((tool, index) =>
      tool.handler({ query: `query-${index}` }, context),
    );
    await vi.waitFor(() => expect(service.search).toHaveBeenCalledTimes(3));

    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const fetchTool = createFetchWebPageTool(
      fetchImpl,
      undefined,
      undefined,
      undefined,
      trafficKey,
    );
    await expect(
      fetchTool.handler({ url: 'https://example.com' }, context),
    ).rejects.toMatchObject({ code: 'fetch_failed' });
    expect(fetchImpl).not.toHaveBeenCalled();

    for (const resolve of resolvers) resolve({ results: [] });
    await expect(Promise.all(pending)).resolves.toHaveLength(3);
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
  it('allows provider discovery and candidate preflight to share one bounded window', () => {
    const tool = createWebSearchTool({
      search: vi.fn().mockResolvedValue({ results: [] }),
    });

    expect(tool.timeoutMs).toBe(WEB_SEARCH_TOOL_TIMEOUT_MS);
    expect(tool.timeoutMs).toBeGreaterThan(SEARCH_PROVIDER_TIMEOUT_MS);
  });

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

  it('does not expose discovery-only Fake-IP candidates to the Agent tool', async () => {
    const service = {
      search: vi.fn().mockResolvedValue({
        results: [],
        uncheckedResults: [
          {
            title: 'Unchecked result',
            url: 'https://example.com/research',
            snippet: 'Provider discovery text is not evidence.',
            accessibility: 'unchecked',
          },
        ],
        failures: [
          {
            domain: 'example.com',
            code: 'candidate_fake_ip_dns_detected',
          },
        ],
      }),
    };
    const tool = createWebSearchTool(service);

    await expect(
      tool.handler({ query: 'research topic' }, context),
    ).resolves.toEqual({ results: [] });
  });

  it('guides three research phases and permits two bounded replacement searches', async () => {
    const metrics = new MetricsRegistry();
    let call = 0;
    const service = {
      search: vi.fn(async ({ query }: { query: string; limit: number }) => {
        call += 1;
        return {
          results: Array.from({ length: 5 }, (_, index) => ({
            title: `${query}-${index}`,
            url: `https://source-${call}-${index}.example.com/article`,
            snippet: '摘要',
          })),
          failures:
            call === 1
              ? [
                  {
                    domain: 'blocked.example.com',
                    code: 'candidate_http_blocked',
                  },
                ]
              : [],
        };
      }),
    };
    const tool = createWebSearchTool(service, {
      deepResearch: true,
      metrics,
    });

    const broad = await tool.handler({ query: 'broad' }, context);
    const gap = await tool.handler({ query: 'gap' }, context);
    const deep = await tool.handler({ query: 'deep' }, context);
    const replacementOne = await tool.handler(
      { query: 'replacement one' },
      context,
    );
    const replacementTwo = await tool.handler(
      { query: 'replacement two' },
      context,
    );

    expect(broad.research).toEqual({
      phase: 'broad',
      failedDomains: ['blocked.example.com'],
      failureCodes: ['candidate_http_blocked'],
      remainingSearches: 4,
      nextAction: 'analyze_gaps',
    });
    expect(gap.research?.phase).toBe('gap');
    expect(deep.research?.phase).toBe('deep');
    expect(deep.research?.nextAction).toBe('read_or_replace');
    expect(replacementOne.research?.phase).toBe('replacement');
    expect(replacementTwo.research).toMatchObject({
      phase: 'replacement',
      remainingSearches: 0,
      nextAction: 'read_sources',
    });
    expect(tool.successfulSearchCount).toBe(5);
    expect(
      [broad, gap, deep, replacementOne, replacementTwo].flatMap(
        (output) => output.results,
      ),
    ).toHaveLength(15);
    expect(metrics.snapshot().counters).toMatchObject({
      'web_search_rounds_total{phase=broad}': 1,
      'web_search_rounds_total{phase=gap}': 1,
      'web_search_rounds_total{phase=deep}': 1,
      'web_search_rounds_total{phase=replacement}': 2,
      web_search_replacements_total: 2,
    });
    await expect(
      tool.handler({ query: 'over budget' }, context),
    ).rejects.toThrow('search_budget_exceeded');
  });

  it('restores completed queries and candidates before continuing the same research operation', async () => {
    const onSearching = vi.fn(async () => undefined);
    const onProgress = vi.fn(async () => undefined);
    const service = {
      search: vi.fn(async () => ({
        results: [
          {
            title: 'existing',
            url: 'https://existing.example/article',
            snippet: 'duplicate',
          },
          {
            title: 'new',
            url: 'https://new.example/article',
            snippet: 'new',
          },
        ],
      })),
    };
    const tool = createWebSearchTool(service, {
      deepResearch: true,
      initialProgress: {
        completedQueries: [' broad  topic '],
        candidateUrls: ['https://existing.example/article'],
      },
      onSearching,
      onProgress,
    });

    expect(tool.successfulSearchCount).toBe(1);
    await expect(
      tool.handler({ query: 'BROAD TOPIC' }, context),
    ).rejects.toThrow('search_query_duplicate');
    const output = await tool.handler({ query: 'gap topic' }, context);

    expect(output.results).toEqual([
      {
        title: 'new',
        url: 'https://new.example/article',
        snippet: 'new',
      },
    ]);
    expect(onSearching).toHaveBeenCalledOnce();
    expect(onProgress).toHaveBeenCalledWith({
      completedQuery: 'gap topic',
      candidateUrls: ['https://new.example/article'],
    });
    expect(tool.successfulSearchCount).toBe(2);
  });
});
