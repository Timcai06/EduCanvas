import { z } from 'zod';
import type {
  SearchProvider,
  SearchRequest,
  SearchResult,
} from './search-contract';
import { SearchProviderError } from './search-contract';
import {
  normalizePublicSearchResultUrl,
  normalizeSearchProviderBaseUrl,
  toSearchResultFields,
} from './search-url';

const searxngResponseSchema = z.object({
  results: z
    .array(
      z.object({
        title: z.string().optional(),
        url: z.string(),
        content: z.string().optional(),
        publishedDate: z.string().optional(),
        engine: z.string().optional(),
      }),
    )
    .optional(),
  number_of_results: z.number().optional(),
});

export interface SearXNGAdapterConfig {
  readonly baseUrl: string;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
  readonly apiKey?: string;
}

export function createSearXNGAdapter(
  config: SearXNGAdapterConfig,
): SearchProvider {
  const fetchImpl = config.fetchImpl ?? fetch;
  const baseUrl = normalizeSearchProviderBaseUrl(config.baseUrl);
  if (!baseUrl) {
    throw new SearchProviderError('search_invalid_response', false);
  }
  const timeoutMs = config.timeoutMs ?? 8_000;

  return {
    name: 'searxng',
    async search(
      request: SearchRequest,
      signal?: AbortSignal,
    ): Promise<readonly SearchResult[]> {
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), timeoutMs);
      const onAbort = () => abort.abort();
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) abort.abort();

      try {
        const params = new URLSearchParams({
          q: request.query,
          format: 'json',
          pageno: '1',
        });

        const headers: Record<string, string> = {
          accept: 'application/json',
        };
        if (config.apiKey) {
          headers['Authorization'] = `Bearer ${config.apiKey}`;
        }

        const response = await fetchImpl(
          `${baseUrl}/search?${params.toString()}`,
          {
            method: 'GET',
            headers,
            signal: abort.signal,
          },
        );

        if (response.status === 429) {
          throw new SearchProviderError('search_rate_limited', true);
        }
        if (!response.ok) {
          throw new SearchProviderError('search_provider_unavailable', true);
        }

        const payload = searxngResponseSchema.parse(await response.json());
        const results: SearchResult[] = [];
        const seen = new Set<string>();

        for (const item of payload.results ?? []) {
          const url = normalizePublicSearchResultUrl(item.url);
          if (!url || seen.has(url)) continue;
          seen.add(url);

          results.push({
            ...toSearchResultFields({
              title: item.title,
              url,
              snippet: item.content,
            }),
            publishedAt: item.publishedDate,
          });

          if (results.length >= request.limit) break;
        }

        return results;
      } catch (error) {
        if (error instanceof SearchProviderError) throw error;
        if (error instanceof z.ZodError) {
          throw new SearchProviderError('search_invalid_response', false);
        }
        if (error instanceof SyntaxError) {
          throw new SearchProviderError('search_invalid_response', false);
        }
        if (error instanceof Error && error.name === 'AbortError') {
          throw new SearchProviderError(
            signal?.aborted ? 'search_cancelled' : 'search_timeout',
            !signal?.aborted,
          );
        }
        if (error instanceof TypeError) {
          throw new SearchProviderError('search_network_error', true);
        }
        throw new SearchProviderError('search_provider_unavailable', false);
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      }
    },
  };
}

export function isSearXNGConfigured(
  environment?: Readonly<{ SEARXNG_BASE_URL?: string }>,
): boolean {
  const url = environment
    ? environment.SEARXNG_BASE_URL
    : process.env.SEARXNG_BASE_URL;
  return Boolean(url && normalizeSearchProviderBaseUrl(url));
}
