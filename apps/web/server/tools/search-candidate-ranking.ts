import type { SearchResult } from './search-contract';

export type SearchCandidateContentKind =
  'article' | 'documentation' | 'institution' | 'other';

export interface SearchCandidateResult extends SearchResult {
  readonly accessibility: 'accessible';
  readonly contentKind: SearchCandidateContentKind;
}

export interface UncheckedSearchCandidateResult extends SearchResult {
  readonly accessibility: 'unchecked';
}

export function searchCandidateDomain(url: string): string {
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

export function searchCandidateContentKind(
  result: SearchResult,
): SearchCandidateContentKind {
  const value = `${result.title} ${new URL(result.url).pathname}`.toLowerCase();
  const domain = searchCandidateDomain(result.url);
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

export function rankReadableCandidates(
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
      const domain = searchCandidateDomain(entry.candidate.url);
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
    const domain = searchCandidateDomain(candidate.url);
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

export function rankUncheckedCandidates(
  candidates: readonly SearchResult[],
  limit: number,
  maxResultsPerDomain: number,
): UncheckedSearchCandidateResult[] {
  const selected: UncheckedSearchCandidateResult[] = [];
  const domains = new Map<string, number>();
  for (const candidate of candidates) {
    const domain = searchCandidateDomain(candidate.url);
    const domainCount = domains.get(domain) ?? 0;
    if (domainCount >= maxResultsPerDomain) continue;
    selected.push({
      ...candidate,
      sourceDomain: candidate.sourceDomain ?? domain,
      accessibility: 'unchecked',
    });
    domains.set(domain, domainCount + 1);
    if (selected.length >= limit) break;
  }
  return selected;
}
