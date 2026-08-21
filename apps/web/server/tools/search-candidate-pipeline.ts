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

export type SearchCandidateContentKind =
  'article' | 'documentation' | 'institution' | 'other';

export interface SearchCandidateResult extends SearchResult {
  readonly accessibility: 'accessible';
  readonly contentKind: SearchCandidateContentKind;
}

export interface SearchCandidateFailure {
  readonly url: string;
  readonly domain: string;
  readonly code: SearchCandidateFailureCode;
  readonly retryable: boolean;
}

export interface SearchCandidateOutput {
  readonly results: readonly SearchCandidateResult[];
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

function domainOf(url: string): string {
  return new URL(url).hostname.toLowerCase().replace(/^www\./u, '');
}

function institutionOf(domain: string): string {
  const labels = domain.split('.');
  if (labels.length <= 2) return domain;
  const suffix = labels.slice(-2).join('.');
  if (
    [
      'ac.cn',
      'com.cn',
      'edu.cn',
      'gov.cn',
      'net.cn',
      'org.cn',
      'ac.uk',
      'co.uk',
      'org.uk',
      'com.au',
      'edu.au',
      'org.au',
    ].includes(suffix)
  ) {
    return labels.slice(-3).join('.');
  }
  return suffix;
}

function contentKindOf(result: SearchResult): SearchCandidateContentKind {
  const value = `${result.title} ${new URL(result.url).pathname}`.toLowerCase();
  const domain = domainOf(result.url);
  if (/\.(?:edu|gov)(?:\.|$)|\.ac\.[a-z]{2}$/u.test(domain)) {
    return 'institution';
  }
  if (/\b(?:docs?|documentation|manual|reference|guide)\b/u.test(value)) {
    return 'documentation';
  }
  if (/\b(?:article|research|paper|report|journal|news|blog)\b/u.test(value)) {
    return 'article';
  }
  return 'other';
}

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

function diverseRank(
  candidates: readonly SearchCandidateResult[],
  limit: number,
  maxResultsPerDomain: number,
): SearchCandidateResult[] {
  const remaining = candidates.map((candidate, index) => ({
    candidate,
    index,
  }));
  const selected: SearchCandidateResult[] = [];
  const domains = new Map<string, number>();
  const institutions = new Map<string, number>();
  const kinds = new Map<SearchCandidateContentKind, number>();

  while (selected.length < limit && remaining.length > 0) {
    let bestIndex = -1;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < remaining.length; index += 1) {
      const entry = remaining[index]!;
      const domain = domainOf(entry.candidate.url);
      const domainCount = domains.get(domain) ?? 0;
      if (domainCount >= maxResultsPerDomain) continue;
      const institutionCount = institutions.get(institutionOf(domain)) ?? 0;
      const kindCount = kinds.get(entry.candidate.contentKind) ?? 0;
      const relevance = entry.candidate.score ?? 1 / (entry.index + 1);
      const score =
        relevance -
        domainCount * 0.35 -
        institutionCount * 0.15 -
        kindCount * 0.08;
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }
    if (bestIndex < 0) break;
    const [entry] = remaining.splice(bestIndex, 1);
    const candidate = entry!.candidate;
    const domain = domainOf(candidate.url);
    const institution = institutionOf(domain);
    selected.push(candidate);
    domains.set(domain, (domains.get(domain) ?? 0) + 1);
    institutions.set(institution, (institutions.get(institution) ?? 0) + 1);
    kinds.set(
      candidate.contentKind,
      (kinds.get(candidate.contentKind) ?? 0) + 1,
    );
  }
  return selected;
}

export class SearchCandidatePipeline {
  private readonly config: Required<SearchCandidatePipelineConfig>;

  constructor(
    private readonly searchService: Pick<SearchService, 'search'>,
    private readonly preflight: SearchCandidatePreflight = preflightSearchCandidate,
    config: SearchCandidatePipelineConfig = {},
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async search(
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

    const groups = new Map<string, SearchResult[]>();
    for (const candidate of unique) {
      const domain = domainOf(candidate.url);
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
              sourceDomain: domainOf(finalUrl),
              accessibility: 'accessible',
              contentKind: contentKindOf({ ...candidate, url: finalUrl }),
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
    const failures = checkedGroups.flatMap((group) => group.failures);
    const readable: SearchCandidateResult[] = [];
    const seenFinalUrls = new Set<string>();
    for (const candidate of checkedGroups.flatMap((group) => group.readable)) {
      if (seenFinalUrls.has(candidate.url)) continue;
      seenFinalUrls.add(candidate.url);
      readable.push(candidate);
    }
    return {
      results: diverseRank(readable, target, this.config.maxResultsPerDomain),
      failures,
      attemptedProviders: searched.attemptedProviders,
    };
  }
}
