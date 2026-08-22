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
    research: z
      .object({
        phase: z.enum(['broad', 'gap', 'deep', 'replacement']),
        failedDomains: z.array(z.string().max(253)).max(8),
        failureCodes: z.array(z.string().max(64)).max(8),
        remainingSearches: z.number().int().min(0).max(5),
        nextAction: z.enum([
          'analyze_gaps',
          'target_critical_gap',
          'read_or_replace',
          'read_sources',
        ]),
      })
      .strict()
      .optional(),
  })
  .strict();

const STANDARD_MAX_SEARCHES = 3;
export const DEEP_RESEARCH_MAX_SEARCHES = 5;
export const WEB_SEARCH_MAX_CANDIDATES = 15;

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
  ): Promise<{
    results: readonly SearchResult[];
    failures?: readonly { domain: string; code: string }[];
  }>;
}

export interface WebSearchToolOptions {
  readonly deepResearch?: boolean;
}

function queryKey(query: string): string {
  return query.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

export function createWebSearchTool(
  service: WebSearchExecutor,
  options: WebSearchToolOptions = {},
): OperationWebSearchTool {
  const completedQueries = new Set<string>();
  const pendingQueries = new Set<string>();
  const candidateUrls = new Set<string>();
  let searchAttempts = 0;
  const maxSearches = options.deepResearch
    ? DEEP_RESEARCH_MAX_SEARCHES
    : STANDARD_MAX_SEARCHES;
  return {
    get successfulSearchCount() {
      return completedQueries.size;
    },
    name: 'webSearch',
    description: options.deepResearch
      ? '分阶段搜索互联网。按 broad、gap、deep 推进，并根据 research.failedDomains 避开失败域；资料不足时可在剩余预算内 replacement。搜索摘要不可直接引用。'
      : '搜索互联网获取时效性信息。输入检索词，返回最多5条候选结果；搜索摘要不可直接作为引用。',
    inputSchema: searchInputSchema,
    outputSchema: searchOutputSchema,
    timeoutMs: 10_000,
    handler: async ({ query }) => {
      const key = queryKey(query);
      if (completedQueries.has(key) || pendingQueries.has(key)) {
        throw new Error('search_query_duplicate');
      }
      if (searchAttempts >= maxSearches) {
        throw new Error('search_budget_exceeded');
      }
      const phase =
        completedQueries.size === 0
          ? 'broad'
          : completedQueries.size === 1
            ? 'gap'
            : completedQueries.size === 2
              ? 'deep'
              : 'replacement';
      pendingQueries.add(key);
      searchAttempts += 1;
      try {
        const output = await service.search({ query: query.trim(), limit: 5 });
        const results: { title: string; url: string; snippet: string }[] = [];
        for (const result of output.results) {
          if (candidateUrls.size >= WEB_SEARCH_MAX_CANDIDATES) break;
          if (candidateUrls.has(result.url)) continue;
          candidateUrls.add(result.url);
          results.push({
            title: result.title,
            url: result.url,
            snippet: result.snippet,
          });
        }
        completedQueries.add(key);
        if (!options.deepResearch) return { results };
        const failures = output.failures ?? [];
        return {
          results,
          research: {
            phase,
            failedDomains: [
              ...new Set(failures.map((failure) => failure.domain)),
            ].slice(0, 8),
            failureCodes: [
              ...new Set(failures.map((failure) => failure.code)),
            ].slice(0, 8),
            remainingSearches: maxSearches - searchAttempts,
            nextAction:
              phase === 'broad'
                ? 'analyze_gaps'
                : phase === 'gap'
                  ? 'target_critical_gap'
                  : phase === 'deep'
                    ? 'read_or_replace'
                    : 'read_sources',
          },
        };
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
  options: WebSearchToolOptions = {},
): OperationWebSearchTool | null {
  const service = resolveSearchService(env, fetchImpl);
  if (!service) return null;
  return createWebSearchTool(new SearchCandidatePipeline(service), options);
}

export function resolveSearchCandidatePipeline(
  env: SearchEnvironment = process.env as SearchEnvironment,
  fetchImpl?: typeof fetch,
): SearchCandidatePipeline | null {
  const service = resolveSearchService(env, fetchImpl);
  return service ? new SearchCandidatePipeline(service) : null;
}
