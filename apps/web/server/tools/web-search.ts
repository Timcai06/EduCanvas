import 'server-only';

import type { AgentTool } from '@educanvas/agent-runtime';
import { z } from 'zod';
import {
  createTavilySearchProvider,
  type SearchProvider,
  type SearchResult,
} from './web-search-provider';

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
  environment?: Readonly<{ SEARCH_API_KEY?: string }>,
): boolean {
  return Boolean(
    (environment
      ? environment.SEARCH_API_KEY
      : process.env.SEARCH_API_KEY
    )?.trim(),
  );
}

export type OperationWebSearchTool = AgentTool<
  z.infer<typeof searchInputSchema>,
  z.infer<typeof searchOutputSchema>
> &
  WebSearchProgress;

function queryKey(query: string): string {
  return query.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

/** Creates one operation-scoped search tool with deterministic research budgets. */
export function createWebSearchTool(
  provider: SearchProvider,
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
        const output = await provider.search({ query: query.trim(), limit: 5 });
        const results: SearchResult[] = [];
        for (const result of output.results) {
          if (candidateUrls.size >= MAX_CANDIDATES) break;
          if (candidateUrls.has(result.url)) continue;
          candidateUrls.add(result.url);
          results.push(result);
        }
        completedQueries.add(key);
        return { results };
      } finally {
        pendingQueries.delete(key);
      }
    },
  };
}

export function resolveWebSearchTool(fetchImpl: typeof fetch = fetch) {
  const apiKey = process.env.SEARCH_API_KEY?.trim();
  if (!apiKey) return null;
  return createWebSearchTool(
    createTavilySearchProvider({
      apiKey,
      baseUrl: process.env.SEARCH_BASE_URL,
      fetchImpl,
    }),
  );
}
