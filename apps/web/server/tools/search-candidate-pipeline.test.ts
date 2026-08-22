import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import type { SearchResult } from './search-contract';
import { SearchCandidatePipeline } from './search-candidate-pipeline';
import {
  preflightSearchCandidate,
  SearchCandidatePreflightError,
} from './search-candidate-preflight';

function candidate(
  index: number,
  domain = `source-${index}.example.com`,
): SearchResult {
  return {
    title: `Research article ${index}`,
    url: `https://${domain}/article-${index}`,
    snippet: `Summary ${index}`,
    score: 1 - index / 100,
  };
}

function searchService(results: readonly SearchResult[]) {
  return {
    search: vi.fn().mockResolvedValue({
      results,
      attemptedProviders: ['primary', 'fallback'],
    }),
  };
}

function readable(result: SearchResult) {
  return {
    finalUrl: result.url,
    title: result.title,
    contentType: 'text/html',
    textLength: 1200,
  };
}

describe('SearchCandidatePipeline', () => {
  it('overfetches and fills five readable slots after the first five fail', async () => {
    const results = Array.from({ length: 10 }, (_, index) => candidate(index));
    const service = searchService(results);
    const preflight = vi.fn(async (result: SearchResult) => {
      const index = Number(new URL(result.url).pathname.split('-').at(-1));
      if (index < 5) {
        throw new SearchCandidatePreflightError(
          'candidate_http_blocked',
          false,
        );
      }
      return readable(result);
    });
    const pipeline = new SearchCandidatePipeline(service, preflight);

    const output = await pipeline.search({ query: 'topic', limit: 5 });

    expect(service.search).toHaveBeenCalledWith(
      { query: 'topic', limit: 15 },
      undefined,
    );
    expect(output.results.map((result) => result.url)).toEqual(
      results.slice(5).map((result) => result.url),
    );
    expect(output.failures).toHaveLength(5);
    expect(output.attemptedProviders).toEqual(['primary', 'fallback']);
  });

  it('normalizes URLs and checks each canonical candidate only once', async () => {
    const duplicate = candidate(0);
    const service = searchService([
      duplicate,
      { ...duplicate, url: `${duplicate.url}#section` },
    ]);
    const preflight = vi.fn(async (result: SearchResult) => readable(result));
    const pipeline = new SearchCandidatePipeline(service, preflight);

    const output = await pipeline.search({ query: 'topic', limit: 5 });

    expect(preflight).toHaveBeenCalledTimes(1);
    expect(output.results).toHaveLength(1);
  });

  it('runs domains concurrently but serializes a domain and cools it after failure', async () => {
    const first = candidate(0, 'blocked.example.com');
    const sameDomain = candidate(1, 'blocked.example.com');
    const other = candidate(2, 'readable.example.org');
    const service = searchService([first, sameDomain, other]);
    const calls: string[] = [];
    const preflight = vi.fn(async (result: SearchResult) => {
      calls.push(result.url);
      if (result.url === first.url) {
        throw new SearchCandidatePreflightError('candidate_rate_limited', true);
      }
      return readable(result);
    });
    const pipeline = new SearchCandidatePipeline(service, preflight);

    const output = await pipeline.search({ query: 'topic', limit: 5 });

    expect(calls).not.toContain(sameDomain.url);
    expect(output.results.map((result) => result.url)).toEqual([other.url]);
    expect(output.failures).toEqual([
      expect.objectContaining({
        url: first.url,
        code: 'candidate_rate_limited',
      }),
      expect.objectContaining({
        url: sameDomain.url,
        code: 'candidate_domain_cooled',
      }),
    ]);
  });

  it('keeps failed domains cooled across later research queries', async () => {
    const blocked = candidate(0, 'blocked.example.com');
    const repeated = candidate(1, 'blocked.example.com');
    const replacement = candidate(2, 'replacement.example.org');
    const service = {
      search: vi
        .fn()
        .mockResolvedValueOnce({
          results: [blocked],
          attemptedProviders: ['primary'],
        })
        .mockResolvedValueOnce({
          results: [repeated, replacement],
          attemptedProviders: ['primary'],
        }),
    };
    const preflight = vi.fn(async (result: SearchResult) => {
      if (result.url === blocked.url) {
        throw new SearchCandidatePreflightError(
          'candidate_http_blocked',
          false,
        );
      }
      return readable(result);
    });
    const pipeline = new SearchCandidatePipeline(service, preflight);

    await pipeline.search({ query: 'broad', limit: 5 });
    const output = await pipeline.search({ query: 'gap', limit: 5 });

    expect(
      preflight.mock.calls.map(([result]) => (result as SearchResult).url),
    ).not.toContain(repeated.url);
    expect(output.results.map((result) => result.url)).toEqual([
      replacement.url,
    ]);
    expect(output.failures).toContainEqual(
      expect.objectContaining({
        domain: 'blocked.example.com',
        code: 'candidate_domain_cooled',
      }),
    );
  });

  it('bounds preflight concurrency', async () => {
    const results = Array.from({ length: 9 }, (_, index) => candidate(index));
    const service = searchService(results);
    let active = 0;
    let peak = 0;
    const preflight = vi.fn(async (result: SearchResult) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active -= 1;
      return readable(result);
    });
    const pipeline = new SearchCandidatePipeline(service, preflight, {
      preflightConcurrency: 3,
    });

    await pipeline.search({ query: 'topic', limit: 5 });

    expect(peak).toBe(3);
  });

  it('keeps failure evidence in candidate order despite concurrent completion', async () => {
    const results = [candidate(0), candidate(1), candidate(2)];
    const delays = [8, 1, 4];
    const pipeline = new SearchCandidatePipeline(
      searchService(results),
      async (result) => {
        const index = results.indexOf(result);
        await new Promise((resolve) => setTimeout(resolve, delays[index]));
        throw new SearchCandidatePreflightError(
          'candidate_network_error',
          true,
        );
      },
    );

    const output = await pipeline.search({ query: 'topic', limit: 5 });

    expect(output.failures.map((failure) => failure.url)).toEqual(
      results.map((result) => result.url),
    );
  });

  it('limits one domain and promotes institution and content-kind diversity', async () => {
    const results = [
      { ...candidate(0, 'news.example.com'), score: 1 },
      { ...candidate(1, 'news.example.com'), score: 0.99 },
      { ...candidate(2, 'news.example.com'), score: 0.98 },
      {
        ...candidate(3, 'docs.example.org'),
        title: 'API documentation guide',
        score: 0.8,
      },
      {
        ...candidate(4, 'university.edu'),
        title: 'University research',
        score: 0.7,
      },
    ];
    const pipeline = new SearchCandidatePipeline(
      searchService(results),
      async (result) => readable(result),
    );

    const output = await pipeline.search({ query: 'topic', limit: 5 });

    expect(
      output.results.filter(
        (result) => result.sourceDomain === 'news.example.com',
      ),
    ).toHaveLength(2);
    expect(output.results.map((result) => result.contentKind)).toEqual(
      expect.arrayContaining(['article', 'documentation', 'institution']),
    );
  });

  it('propagates external cancellation instead of reporting an ordinary candidate failure', async () => {
    const controller = new AbortController();
    const pipeline = new SearchCandidatePipeline(
      searchService([candidate(0)]),
      async () => {
        controller.abort();
        throw new SearchCandidatePreflightError('candidate_timeout', true);
      },
    );

    await expect(
      pipeline.search({ query: 'topic', limit: 5 }, controller.signal),
    ).rejects.toMatchObject({ code: 'search_cancelled' });
  });
});

describe('preflightSearchCandidate', () => {
  const publicDns = vi.fn().mockResolvedValue(['93.184.216.34']);

  it.each([
    [403, 'candidate_http_blocked'],
    [429, 'candidate_rate_limited'],
  ])('classifies HTTP %i', async (status, code) => {
    await expect(
      preflightSearchCandidate(candidate(0), undefined, {
        resolveHostname: publicDns,
        request: vi.fn().mockResolvedValue(new Response(null, { status })),
      }),
    ).rejects.toMatchObject({ code });
  });

  it.each([
    [404, false],
    [500, true],
  ])(
    'classifies HTTP %i separately from network failures',
    async (status, retryable) => {
      await expect(
        preflightSearchCandidate(candidate(0), undefined, {
          resolveHostname: publicDns,
          request: vi.fn().mockResolvedValue(new Response(null, { status })),
        }),
      ).rejects.toMatchObject({
        code: 'candidate_http_error',
        retryable,
      });
    },
  );

  it('classifies unsupported formats, login walls, empty pages and render shells', async () => {
    const run = (body: string, contentType = 'text/html') =>
      preflightSearchCandidate(candidate(0), undefined, {
        resolveHostname: publicDns,
        request: vi
          .fn()
          .mockResolvedValue(
            new Response(body, { headers: { 'content-type': contentType } }),
          ),
      });

    await expect(run('%PDF', 'application/pdf')).rejects.toMatchObject({
      code: 'candidate_unsupported_format',
    });
    await expect(
      run('<title>Sign in</title><input type="password">'),
    ).rejects.toMatchObject({ code: 'candidate_login_wall' });
    await expect(run('<html><body></body></html>')).rejects.toMatchObject({
      code: 'candidate_empty_content',
    });
    await expect(
      run('<div id="__next"></div><script src="/app.js"></script>'),
    ).rejects.toMatchObject({ code: 'candidate_render_required' });

    await expect(
      run(
        `<nav>Sign in</nav><article>${'Readable research text '.repeat(80)}</article>`,
      ),
    ).resolves.toMatchObject({ textLength: expect.any(Number) });
  });

  it('classifies timeout causes and blocked DNS addresses', async () => {
    await expect(
      preflightSearchCandidate(candidate(0), undefined, {
        resolveHostname: publicDns,
        request: vi
          .fn()
          .mockRejectedValue(new DOMException('aborted', 'AbortError')),
      }),
    ).rejects.toMatchObject({ code: 'candidate_timeout', retryable: true });

    await expect(
      preflightSearchCandidate(candidate(0), undefined, {
        resolveHostname: vi.fn().mockResolvedValue(['127.0.0.1']),
      }),
    ).rejects.toMatchObject({
      code: 'candidate_blocked_address',
      retryable: false,
    });
  });
});
