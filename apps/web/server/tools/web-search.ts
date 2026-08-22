import 'server-only';

import type { AgentTool } from '@educanvas/agent-runtime';
import { z } from 'zod';
import type { SearchProvider, SearchResult } from './search-contract';
import { SearchProviderRegistry } from './search-registry';
import { SearchService, type SearchServiceConfig } from './search-service';
import { normalizeSearchProviderBaseUrl } from './search-url';
import { SearchCandidatePipeline } from './search-candidate-pipeline';
import {
  createTavilyAdapter,
  type TavilyAdapterConfig,
} from './tavily-adapter';
import {
  createSearXNGAdapter,
  isSearXNGConfigured,
  type SearXNGAdapterConfig,
} from './searxng-adapter';

const searchInputSchema = z
  .object({ query: z.string().trim().min(1).max(200) })
  .strict();
const searchOutputSchema = z
  .object({
    results: z
      .array(
        z
          .object({
            title: z.string().max(200),
            url: z.string().max(1024),
            snippet: z.string().max(400),
          })
          .strict(),
      )
      .max(5),
  })
  .strict();

const MAX_SEARCHES = 3;
const MAX_CANDIDATES = 15;

export interface WebSearchProgress {
  readonly successfulSearchCount: number;
}

export function isWebSearchConfigured(
  environment?: Readonly<{
    SEARCH_API_KEY?: string;
    SEARCH_BASE_URL?: string;
    SEARXNG_BASE_URL?: string;
  }>,
): boolean {
  const env = environment ?? process.env;
  const searxngUrl = env.SEARXNG_BASE_URL;
  return (
    Boolean(
      env.SEARCH_API_KEY?.trim() &&
      (!env.SEARCH_BASE_URL ||
        normalizeSearchProviderBaseUrl(env.SEARCH_BASE_URL)),
    ) || isSearXNGConfigured({ SEARXNG_BASE_URL: searxngUrl })
  );
}

export type OperationWebSearchTool = AgentTool<
  z.infer<typeof searchInputSchema>,
  z.infer<typeof searchOutputSchema>
> &
  WebSearchProgress;

interface WebSearchExecutor {
  search(
    request: { query: string; limit: number },
    signal?: AbortSignal,
  ): Promise<{ results: readonly SearchResult[] }>;
}

function queryKey(query: string): string {
  return query.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

export function createWebSearchTool(
  service: WebSearchExecutor,
): OperationWebSearchTool {
  const completedQueries = new Set<string>();
  const pendingQueries = new Set<string>();
  const candidateUrls = new Set<string>();
  return {
    get successfulSearchCount() {
      return completedQueries.size;
    },
    name: 'webSearch',
    description:
      '搜索互联网获取时效性信息。输入检索词，返回最多5条候选结果；搜索摘要不可直接作为引用。',
    inputSchema: searchInputSchema,
    outputSchema: searchOutputSchema,
    timeoutMs: 10_000,
    handler: async ({ query }) => {
      const key = queryKey(query);
      if (completedQueries.has(key) || pendingQueries.has(key)) {
        throw new Error('search_query_duplicate');
      }
      if (completedQueries.size + pendingQueries.size >= MAX_SEARCHES) {
        throw new Error('search_budget_exceeded');
      }
      pendingQueries.add(key);
      try {
        const output = await service.search({ query: query.trim(), limit: 5 });
        const results: { title: string; url: string; snippet: string }[] = [];
        for (const result of output.results) {
          if (candidateUrls.size >= MAX_CANDIDATES) break;
          if (candidateUrls.has(result.url)) continue;
          candidateUrls.add(result.url);
          results.push({
            title: result.title,
            url: result.url,
            snippet: result.snippet,
          });
        }
        completedQueries.add(key);
        return { results };
      } finally {
        pendingQueries.delete(key);
      }
    },
  };
}

export interface SearchEnvironment {
  SEARCH_API_KEY?: string;
  SEARCH_BASE_URL?: string;
  SEARXNG_BASE_URL?: string;
  SEARXNG_API_KEY?: string;
}

export function resolveSearchProviders(
  env: SearchEnvironment = process.env as SearchEnvironment,
  fetchImpl?: typeof fetch,
): readonly SearchProvider[] {
  const providers: SearchProvider[] = [];

  if (
    env.SEARCH_API_KEY?.trim() &&
    (!env.SEARCH_BASE_URL ||
      normalizeSearchProviderBaseUrl(env.SEARCH_BASE_URL))
  ) {
    const config: TavilyAdapterConfig = {
      apiKey: env.SEARCH_API_KEY.trim(),
      ...(env.SEARCH_BASE_URL?.trim()
        ? { baseUrl: env.SEARCH_BASE_URL.trim() }
        : {}),
      ...(fetchImpl ? { fetchImpl } : {}),
    };
    providers.push(createTavilyAdapter(config));
  }

  const searxngUrl = env.SEARXNG_BASE_URL;
  if (
    isSearXNGConfigured({ SEARXNG_BASE_URL: searxngUrl }) &&
    searxngUrl?.trim()
  ) {
    const config: SearXNGAdapterConfig = {
      baseUrl: searxngUrl.trim(),
      ...(env.SEARXNG_API_KEY?.trim()
        ? { apiKey: env.SEARXNG_API_KEY.trim() }
        : {}),
      ...(fetchImpl ? { fetchImpl } : {}),
    };
    providers.push(createSearXNGAdapter(config));
  }

  return providers;
}

export function resolveSearchService(
  env: SearchEnvironment = process.env as SearchEnvironment,
  fetchImpl?: typeof fetch,
  config?: SearchServiceConfig,
): SearchService | null {
  const providers = resolveSearchProviders(env, fetchImpl);
  if (providers.length === 0) return null;

  const registry = new SearchProviderRegistry();
  for (const provider of providers) {
    registry.register(provider);
  }

  return new SearchService({ registry, config });
}

export function resolveWebSearchTool(
  env: SearchEnvironment = process.env as SearchEnvironment,
  fetchImpl?: typeof fetch,
): OperationWebSearchTool | null {
  const service = resolveSearchService(env, fetchImpl);
  if (!service) return null;
  return createWebSearchTool(new SearchCandidatePipeline(service));
}

export function resolveSearchCandidatePipeline(
  env: SearchEnvironment = process.env as SearchEnvironment,
  fetchImpl?: typeof fetch,
): SearchCandidatePipeline | null {
  const service = resolveSearchService(env, fetchImpl);
  return service ? new SearchCandidatePipeline(service) : null;
}
