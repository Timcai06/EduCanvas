/**
 * Provider-neutral search contract. All provider SDK types, credentials,
 * raw requests, and raw responses stop at adapter boundaries.
 */

export interface SearchRequest {
  readonly query: string;
  readonly limit: number;
}

export interface SearchResult {
  readonly title: string;
  readonly url: string;
  readonly snippet: string;
  readonly score?: number;
  readonly publishedAt?: string;
  readonly sourceDomain?: string;
}

export type SearchProviderFailureCode =
  | 'search_timeout'
  | 'search_cancelled'
  | 'search_rate_limited'
  | 'search_provider_unavailable'
  | 'search_invalid_response'
  | 'search_network_error';

export class SearchProviderError extends Error {
  override readonly name = 'SearchProviderError';

  constructor(
    readonly code: SearchProviderFailureCode,
    readonly retryable: boolean,
    options?: { cause?: unknown },
  ) {
    super(code, options);
  }
}

export interface SearchProvider {
  readonly name: string;
  search(
    request: SearchRequest,
    signal?: AbortSignal,
  ): Promise<readonly SearchResult[]>;
}

export type ProviderHealthStatus = 'healthy' | 'cooldown' | 'disabled';

export interface ProviderHealth {
  readonly status: ProviderHealthStatus;
  readonly consecutiveFailures: number;
  readonly lastFailureAt?: Date;
  readonly cooldownExpiresAt?: Date;
}
