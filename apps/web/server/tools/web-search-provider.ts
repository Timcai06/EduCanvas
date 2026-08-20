import 'server-only';

import type { SearchResult } from './search-contract';
import {
  createTavilyAdapter,
  type TavilyAdapterConfig,
} from './tavily-adapter';

export type { SearchResult } from './search-contract';

export interface SearchProvider {
  search(input: {
    query: string;
    limit: number;
  }): Promise<{ results: readonly SearchResult[] }>;
}

/** Preserves the pre-WS02 provider shape for server-only compatibility callers. */
export function createTavilySearchProvider(
  input: TavilyAdapterConfig,
): SearchProvider {
  const adapter = createTavilyAdapter(input);
  return {
    async search(request) {
      return { results: await adapter.search(request) };
    },
  };
}
