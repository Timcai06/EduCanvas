import type {
  SearchProvider,
  SearchProviderFailureCode,
  SearchRequest,
  SearchResult,
} from './search-contract';
import { SearchProviderError } from './search-contract';
import { SearchProviderRegistry } from './search-registry';
import {
  NOOP_METRICS,
  recordMetricSafely,
  type MetricsPort,
} from '@educanvas/telemetry';
import {
  SEARCH_PROVIDER_TIMEOUT_MS,
  SEARCH_TOTAL_BUDGET_MS,
} from './search-budgets';

export type SearchServiceFailureCode =
  | 'search_not_configured'
  | 'search_timeout'
  | 'search_rate_limited'
  | 'search_provider_unavailable'
  | 'search_invalid_response'
  | 'search_budget_exhausted'
  | 'search_cancelled';

export class SearchServiceError extends Error {
  override readonly name = 'SearchServiceError';

  constructor(
    readonly code: SearchServiceFailureCode,
    readonly retryable: boolean,
  ) {
    super(code);
  }
}

export interface SearchServiceConfig {
  readonly providerTimeoutMs?: number;
  readonly totalBudgetMs?: number;
  readonly maxProviderAttempts?: number;
  readonly maxResults?: number;
}

const DEFAULT_CONFIG: Required<SearchServiceConfig> = {
  providerTimeoutMs: SEARCH_PROVIDER_TIMEOUT_MS,
  totalBudgetMs: SEARCH_TOTAL_BUDGET_MS,
  maxProviderAttempts: 2,
  maxResults: 15,
};

export interface SearchServiceDeps {
  readonly registry: SearchProviderRegistry;
  readonly config?: SearchServiceConfig;
  readonly now?: () => Date;
  readonly metrics?: MetricsPort;
}

function providerMetricName(name: string): 'tavily' | 'searxng' | 'unknown' {
  return name === 'tavily' || name === 'searxng' ? name : 'unknown';
}

function providerMetricOutcome(
  error: unknown,
): 'failed' | 'timeout' | 'cancelled' {
  const code =
    error instanceof SearchProviderError || error instanceof SearchServiceError
      ? error.code
      : null;
  if (code === 'search_cancelled') return 'cancelled';
  if (code === 'search_timeout' || code === 'search_budget_exhausted') {
    return 'timeout';
  }
  return 'failed';
}

function classifyProviderError(error: unknown): {
  code: SearchProviderFailureCode;
  retryable: boolean;
} {
  if (error instanceof SearchProviderError) {
    return { code: error.code, retryable: error.retryable };
  }
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    if (message.includes('timeout') || message.includes('aborted')) {
      return { code: 'search_timeout', retryable: true };
    }
    if (message.includes('429') || message.includes('rate')) {
      return { code: 'search_rate_limited', retryable: true };
    }
    if (message.includes('network') || message.includes('fetch')) {
      return { code: 'search_network_error', retryable: true };
    }
  }
  return { code: 'search_provider_unavailable', retryable: false };
}

function shouldFailover(error: {
  code: SearchProviderFailureCode;
  retryable: boolean;
}): boolean {
  return error.retryable;
}

export class SearchService {
  private readonly registry: SearchProviderRegistry;
  private readonly config: Required<SearchServiceConfig>;
  private readonly now: () => Date;
  private readonly metrics: MetricsPort;

  constructor(deps: SearchServiceDeps) {
    this.registry = deps.registry;
    this.config = {
      ...DEFAULT_CONFIG,
      ...deps.config,
    };
    this.now = deps.now ?? (() => new Date());
    this.metrics = deps.metrics ?? NOOP_METRICS;
  }

  async search(
    request: SearchRequest,
    signal?: AbortSignal,
  ): Promise<{
    results: readonly SearchResult[];
    attemptedProviders: readonly string[];
  }> {
    const startTime = this.now().getTime();
    const available = this.registry.getAvailableProviders();

    if (
      available.length === 0 &&
      this.registry.getProviderNames().length === 0
    ) {
      throw new SearchServiceError('search_not_configured', false);
    }
    if (available.length === 0) {
      throw new SearchServiceError('search_provider_unavailable', true);
    }

    const allResults: SearchResult[] = [];
    const attempted: string[] = [];
    const seenUrls = new Set<string>();
    let lastError: {
      code: SearchProviderFailureCode;
      retryable: boolean;
    } | null = null;

    for (const provider of available.slice(
      0,
      this.config.maxProviderAttempts,
    )) {
      if (signal?.aborted) {
        throw new SearchServiceError('search_cancelled', false);
      }

      const elapsed = this.now().getTime() - startTime;
      if (elapsed >= this.config.totalBudgetMs) {
        throw new SearchServiceError('search_budget_exhausted', false);
      }

      const remainingBudget = this.config.totalBudgetMs - elapsed;
      const providerTimeout = Math.min(
        this.config.providerTimeoutMs,
        remainingBudget,
      );

      if (providerTimeout <= 0) {
        throw new SearchServiceError('search_budget_exhausted', false);
      }

      attempted.push(provider.name);

      try {
        const results = await this.executeWithTimeout(
          provider,
          request,
          providerTimeout,
          signal,
        );
        for (const result of results) {
          if (!seenUrls.has(result.url)) {
            seenUrls.add(result.url);
            allResults.push(result);
          }
        }
        this.registry.recordSuccess(provider.name);
        recordMetricSafely(() =>
          this.metrics.increment('web_search_provider_attempts_total', {
            provider: providerMetricName(provider.name),
            outcome: 'success',
          }),
        );
        if (
          allResults.length >= Math.min(request.limit, this.config.maxResults)
        ) {
          break;
        }
      } catch (error) {
        recordMetricSafely(() =>
          this.metrics.increment('web_search_provider_attempts_total', {
            provider: providerMetricName(provider.name),
            outcome: providerMetricOutcome(error),
          }),
        );
        // Short-circuit: if the error is already a SearchServiceError (e.g. abort
        // signal rejection from executeWithTimeout), re-throw directly instead of
        // reclassifying — the code is already canonical.
        if (error instanceof SearchServiceError) {
          throw error;
        }
        const classified = classifyProviderError(error);
        lastError = classified;
        this.registry.recordFailure(provider.name);

        if (!shouldFailover(classified)) {
          throw new SearchServiceError(
            this.mapToServiceError(classified.code),
            classified.retryable,
          );
        }
      }
    }

    if (allResults.length === 0 && attempted.length > 0 && lastError) {
      if (this.now().getTime() - startTime >= this.config.totalBudgetMs) {
        throw new SearchServiceError('search_budget_exhausted', false);
      }
      throw new SearchServiceError(
        this.mapToServiceError(lastError.code),
        lastError.retryable,
      );
    }

    return {
      results: allResults.slice(
        0,
        Math.min(request.limit, this.config.maxResults),
      ),
      attemptedProviders: attempted,
    };
  }

  private async executeWithTimeout(
    provider: SearchProvider,
    request: SearchRequest,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<readonly SearchResult[]> {
    return new Promise((resolve, reject) => {
      const controller = new AbortController();
      let settled = false;
      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      };
      const rejectOnce = (error: Error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };
      const timer = setTimeout(() => {
        controller.abort();
        rejectOnce(new SearchProviderError('search_timeout', true));
      }, timeoutMs);

      const onAbort = () => {
        controller.abort();
        rejectOnce(new SearchServiceError('search_cancelled', false));
      };

      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) onAbort();

      provider
        .search(request, controller.signal)
        .then((results) => {
          if (settled) return;
          settled = true;
          cleanup();
          resolve(results);
        })
        .catch((error) => {
          rejectOnce(
            error instanceof Error ? error : new Error('search_failed'),
          );
        });
    });
  }

  private mapToServiceError(
    code: SearchProviderFailureCode,
  ): SearchServiceFailureCode {
    switch (code) {
      case 'search_timeout':
        return 'search_timeout';
      case 'search_cancelled':
        return 'search_cancelled';
      case 'search_rate_limited':
        return 'search_rate_limited';
      case 'search_network_error':
        return 'search_provider_unavailable';
      case 'search_provider_unavailable':
        return 'search_provider_unavailable';
      case 'search_invalid_response':
        return 'search_invalid_response';
    }
  }
}
