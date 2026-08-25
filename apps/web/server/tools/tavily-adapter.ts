import { z } from 'zod';
import type {
  SearchProvider,
  SearchRequest,
  SearchResult,
} from './search-contract';
import {
  boundSearchResultLimit,
  SearchProviderError,
  SEARCH_PROVIDER_MAX_RESULTS,
  SEARCH_RESULT_MAX_URL_LENGTH,
} from './search-contract';
import {
  normalizePublicSearchResultUrl,
  normalizeSearchProviderBaseUrl,
  toSearchResultFields,
} from './search-url';
import { readSearchProviderJson } from './search-provider-response';
import { SEARCH_PROVIDER_TIMEOUT_MS } from './search-budgets';

const tavilyResponseSchema = z.object({
  results: z
    .array(
      z.object({
        title: z.string().optional(),
        url: z.string().max(SEARCH_RESULT_MAX_URL_LENGTH),
        content: z.string().optional(),
        score: z.number().optional(),
        published_date: z.string().max(128).optional(),
      }),
    )
    .max(SEARCH_PROVIDER_MAX_RESULTS)
    .optional(),
});

export interface TavilyAdapterConfig {
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

export function createTavilyAdapter(
  config: TavilyAdapterConfig,
): SearchProvider {
  const fetchImpl = config.fetchImpl ?? fetch;
  const baseUrl = normalizeSearchProviderBaseUrl(
    config.baseUrl?.trim() || 'https://api.tavily.com',
  );
  if (!baseUrl) {
    throw new SearchProviderError('search_invalid_response', false);
  }
  const timeoutMs = config.timeoutMs ?? SEARCH_PROVIDER_TIMEOUT_MS;

  return {
    name: 'tavily',
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
        const resultLimit = boundSearchResultLimit(request.limit);
        const response = await fetchImpl(`${baseUrl}/search`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            api_key: config.apiKey,
            query: request.query,
            max_results: resultLimit,
            include_answer: false,
            include_raw_content: false,
          }),
          signal: abort.signal,
        });

        if (response.status === 429) {
          throw new SearchProviderError('search_rate_limited', true);
        }
        if (!response.ok) {
          throw new SearchProviderError('search_provider_unavailable', true);
        }

        const payload = tavilyResponseSchema.parse(
          await readSearchProviderJson(response, abort.signal),
        );
        const results: SearchResult[] = [];
        const seen = new Set<string>();

        if (resultLimit === 0) return results;

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
            score: item.score,
            publishedAt: item.published_date,
          });

          if (results.length >= resultLimit) {
            break;
          }
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
