import { afterEach, describe, expect, it, vi } from 'vitest';
import { searchWebSources } from './web-search-client';

afterEach(() => vi.unstubAllGlobals());

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

describe('web search browser client', () => {
  it('validates the public result contract and trims the query', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        results: [
          {
            title: 'Article',
            url: 'https://example.com/article',
            domain: 'example.com',
            snippet: 'Summary',
            accessibility: 'unchecked',
            imported: false,
          },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      searchWebSources('  topic  ', '/search'),
    ).resolves.toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledWith('/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: 'topic' }),
    });
  });

  it('rejects provider-private or malformed response fields', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          results: [
            {
              title: 'Article',
              url: 'https://example.com/article',
              domain: 'example.com',
              snippet: 'Summary',
              accessibility: 'unchecked',
              imported: false,
              provider: 'must-not-cross-boundary',
            },
          ],
        }),
      ),
    );

    await expect(searchWebSources('topic')).rejects.toMatchObject({
      code: 'search_invalid_response',
      retryable: true,
    });
  });

  it('keeps stable server retryability and message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(
          {
            error: {
              code: 'search_rate_limited',
              message: '网页搜索请求过于频繁。请稍后重试。',
              retryable: true,
            },
          },
          { status: 429 },
        ),
      ),
    );

    await expect(searchWebSources('topic')).rejects.toMatchObject({
      code: 'search_rate_limited',
      retryable: true,
      message: '网页搜索请求过于频繁。请稍后重试。',
    });
  });
});
