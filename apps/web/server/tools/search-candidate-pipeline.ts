import 'server-only';

import type { SearchRequest, SearchResult } from './search-contract';
import {
  preflightSearchCandidate,
  SearchCandidatePreflightError,
  type SearchCandidateFailureCode,
  type SearchCandidatePreflight,
} from './search-candidate-preflight';
import { SearchServiceError, type SearchService } from './search-service';
import { normalizePublicSearchResultUrl } from './search-url';
import {
  rankReadableCandidates,
  rankUncheckedCandidates,
  searchCandidateContentKind,
  searchCandidateDomain,
  type SearchCandidateResult,
  type UncheckedSearchCandidateResult,
} from './search-candidate-ranking';
import {
  NOOP_METRICS,
  recordMetricSafely,
  type MetricsPort,
} from '@educanvas/telemetry';

export interface SearchCandidateFailure {
  readonly url: string;
  readonly domain: string;
  readonly code: SearchCandidateFailureCode;
  readonly retryable: boolean;
}

export interface SearchCandidateOutput {
  readonly results: readonly SearchCandidateResult[];
  /**
   * Discovery-only candidates retained when Fake-IP DNS prevents safe
   * reachability checks. Agent tools deliberately ignore this collection.
   */
  readonly uncheckedResults: readonly UncheckedSearchCandidateResult[];
  readonly failures: readonly SearchCandidateFailure[];
  readonly attemptedProviders: readonly string[];
}

export interface SearchCandidatePipelineConfig {
  readonly targetResults?: number;
  readonly overfetchFactor?: number;
  readonly maxCandidates?: number;
  readonly preflightConcurrency?: number;
  readonly maxResultsPerDomain?: number;
}

const DEFAULT_CONFIG: Required<SearchCandidatePipelineConfig> = {
  targetResults: 5,
  overfetchFactor: 3,
  maxCandidates: 15,
  preflightConcurrency: 3,
  maxResultsPerDomain: 2,
};

async function mapWithConcurrency<Input, Output>(
  inputs: readonly Input[],
  concurrency: number,
  mapper: (input: Input, index: number) => Promise<Output>,
): Promise<Output[]> {
  const outputs = new Array<Output>(inputs.length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < inputs.length) {
      const index = nextIndex;
      nextIndex += 1;
      outputs[index] = await mapper(inputs[index] as Input, index);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, inputs.length) }, worker),
  );
  return outputs;
}

export class SearchCandidatePipeline {
  private readonly config: Required<SearchCandidatePipelineConfig>;
  private readonly cooledDomains = new Set<string>();

  constructor(
    private readonly searchService: Pick<SearchService, 'search'>,
    private readonly preflight: SearchCandidatePreflight = preflightSearchCandidate,
    config: SearchCandidatePipelineConfig = {},
    private readonly metrics: MetricsPort = NOOP_METRICS,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async search(
    request: SearchRequest,
    signal?: AbortSignal,
  ): Promise<SearchCandidateOutput> {
    const startedAt = Date.now();
    try {
      const output = await this.searchUnobserved(request, signal);
      recordMetricSafely(() =>
        this.metrics.record('web_search_duration_ms', Date.now() - startedAt, {
          outcome: 'success',
        }),
      );
      for (const failure of output.failures) {
        recordMetricSafely(() =>
          this.metrics.increment('web_search_failures_total', {
            category: candidateFailureCategory(failure.code),
          }),
        );
      }
      return output;
    } catch (error) {
      recordMetricSafely(() =>
        this.metrics.record('web_search_duration_ms', Date.now() - startedAt, {
          outcome:
            error instanceof SearchServiceError &&
            error.code === 'search_cancelled'
              ? 'cancelled'
              : 'failed',
        }),
      );
      throw error;
    }
  }

  private async searchUnobserved(
    request: SearchRequest,
    signal?: AbortSignal,
  ): Promise<SearchCandidateOutput> {
    const target = Math.min(request.limit, this.config.targetResults);
    const candidateLimit = Math.min(
      this.config.maxCandidates,
      Math.max(target, target * this.config.overfetchFactor),
    );
    const searched = await this.searchService.search(
      { ...request, limit: candidateLimit },
      signal,
    );
    const unique: SearchResult[] = [];
    const seen = new Set<string>();
    for (const candidate of searched.results) {
      const normalized = normalizePublicSearchResultUrl(candidate.url);
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      unique.push({
        ...candidate,
        url: normalized,
        score: candidate.score ?? 1 / (unique.length + 1),
      });
      if (unique.length >= candidateLimit) break;
    }
    recordMetricSafely(() =>
      this.metrics.record('web_search_candidates', unique.length),
    );

    const groups = new Map<string, SearchResult[]>();
    const priorRoundFailures: SearchCandidateFailure[] = [];
    for (const candidate of unique) {
      const domain = searchCandidateDomain(candidate.url);
      if (this.cooledDomains.has(domain)) {
        priorRoundFailures.push({
          url: candidate.url,
          domain,
          code: 'candidate_domain_cooled',
          retryable: true,
        });
        continue;
      }
      const group = groups.get(domain) ?? [];
      group.push(candidate);
      groups.set(domain, group);
    }
    const checkedGroups = await mapWithConcurrency(
      [...groups.entries()],
      this.config.preflightConcurrency,
      async ([domain, candidates]): Promise<{
        readable: SearchCandidateResult[];
        failures: SearchCandidateFailure[];
      }> => {
        const readable: SearchCandidateResult[] = [];
        const failures: SearchCandidateFailure[] = [];
        let cooled = false;
        for (const candidate of candidates) {
          if (cooled) {
            failures.push({
              url: candidate.url,
              domain,
              code: 'candidate_domain_cooled',
              retryable: true,
            });
            continue;
          }
          try {
            const outcome = await this.preflight(candidate, signal);
            const finalUrl = normalizePublicSearchResultUrl(outcome.finalUrl);
            if (!finalUrl) {
              throw new SearchCandidatePreflightError(
                'candidate_blocked_address',
                false,
              );
            }
            readable.push({
              ...candidate,
              title: outcome.title?.trim() || candidate.title,
              url: finalUrl,
              sourceDomain: searchCandidateDomain(finalUrl),
              accessibility: 'accessible',
              contentKind: searchCandidateContentKind({
                ...candidate,
                url: finalUrl,
              }),
            });
          } catch (error) {
            if (signal?.aborted) {
              throw new SearchServiceError('search_cancelled', false);
            }
            const failure =
              error instanceof SearchCandidatePreflightError
                ? error
                : new SearchCandidatePreflightError(
                    'candidate_network_error',
                    true,
                  );
            cooled = true;
            this.cooledDomains.add(domain);
            failures.push({
              url: candidate.url,
              domain,
              code: failure.code,
              retryable: failure.retryable,
            });
          }
        }
        return { readable, failures };
      },
    );
    const failures = [
      ...priorRoundFailures,
      ...checkedGroups.flatMap((group) => group.failures),
    ];
    const readable: SearchCandidateResult[] = [];
    const seenFinalUrls = new Set<string>();
    for (const candidate of checkedGroups.flatMap((group) => group.readable)) {
      if (seenFinalUrls.has(candidate.url)) continue;
      seenFinalUrls.add(candidate.url);
      readable.push(candidate);
    }
    recordMetricSafely(() =>
      this.metrics.record('web_search_readable_candidates', readable.length),
    );
    const fakeIpDnsDetected = failures.some(
      (failure) => failure.code === 'candidate_fake_ip_dns_detected',
    );
    return {
      results: rankReadableCandidates(
        readable,
        target,
        this.config.maxResultsPerDomain,
      ),
      uncheckedResults:
        readable.length === 0 && fakeIpDnsDetected
          ? rankUncheckedCandidates(
              unique,
              target,
              this.config.maxResultsPerDomain,
            )
          : [],
      failures,
      attemptedProviders: searched.attemptedProviders,
    };
  }
}

function candidateFailureCategory(
  code: SearchCandidateFailureCode,
):
  | 'blocked'
  | 'http'
  | 'access'
  | 'content'
  | 'timeout'
  | 'rate_limited'
  | 'render'
  | 'network'
  | 'cooled'
  | 'unknown' {
  if (
    code === 'candidate_blocked_address' ||
    code === 'candidate_fake_ip_dns_detected'
  ) {
    return 'blocked';
  }
  if (code === 'candidate_http_blocked' || code === 'candidate_http_error') {
    return 'http';
  }
  if (code === 'candidate_login_wall') return 'access';
  if (
    code === 'candidate_empty_content' ||
    code === 'candidate_unsupported_format' ||
    code === 'candidate_too_large'
  ) {
    return 'content';
  }
  if (code === 'candidate_timeout') return 'timeout';
  if (code === 'candidate_rate_limited') return 'rate_limited';
  if (
    code === 'candidate_render_required' ||
    code === 'candidate_render_unavailable'
  ) {
    return 'render';
  }
  if (code === 'candidate_network_error') return 'network';
  if (code === 'candidate_domain_cooled') return 'cooled';
  return 'unknown';
}
