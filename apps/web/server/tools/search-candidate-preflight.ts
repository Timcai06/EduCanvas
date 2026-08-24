import 'server-only';

import {
  WebPageError,
  fetchWebPage,
  type FetchWebPageOptions,
} from '@educanvas/asset-processing';
import { nodeWebPageConnector } from '@educanvas/asset-processing/node';
import type { SearchResult } from './search-contract';
import { normalizePublicSearchResultUrl } from './search-url';

export type SearchCandidateFailureCode =
  | 'candidate_blocked_address'
  | 'candidate_fake_ip_dns_detected'
  | 'candidate_http_blocked'
  | 'candidate_http_error'
  | 'candidate_login_wall'
  | 'candidate_empty_content'
  | 'candidate_rate_limited'
  | 'candidate_timeout'
  | 'candidate_unsupported_format'
  | 'candidate_render_required'
  | 'candidate_render_unavailable'
  | 'candidate_too_large'
  | 'candidate_network_error'
  | 'candidate_domain_cooled';

export interface CandidatePreflightSuccess {
  readonly finalUrl: string;
  readonly title: string | null;
  readonly contentType: string;
  readonly textLength: number;
}

export class SearchCandidatePreflightError extends Error {
  override readonly name = 'SearchCandidatePreflightError';

  constructor(
    readonly code: SearchCandidateFailureCode,
    readonly retryable: boolean,
  ) {
    super(code);
  }
}

export type SearchCandidatePreflight = (
  result: SearchResult,
  signal?: AbortSignal,
) => Promise<CandidatePreflightSuccess>;

function isLoginWall(
  html: string,
  title: string | null,
  textLength: number,
): boolean {
  const lead = `${title ?? ''} ${html.slice(0, 4_000)}`;
  return (
    /<input[^>]+type=["']?password/iu.test(lead) ||
    (textLength < 800 &&
      /(?:登录|登入|请先登录|sign\s*in|log\s*in|subscribe\s+to\s+continue|access\s+requires\s+an\s+account)/iu.test(
        lead,
      ))
  );
}

function hasClientRenderShell(html: string): boolean {
  return (
    /<script(?:\s|>)/iu.test(html) &&
    /<(?:div|main)[^>]+id=["'](?:root|app|__next)["']/iu.test(html)
  );
}

function combineSignals(
  internal: AbortSignal | null | undefined,
  external: AbortSignal | undefined,
): AbortSignal | undefined {
  const signals = [internal, external].filter(
    (signal): signal is AbortSignal => signal !== null && signal !== undefined,
  );
  if (signals.length === 0) return undefined;
  if (signals.length === 1) return signals[0];
  return AbortSignal.any(signals);
}

function mapWebPageError(error: WebPageError): SearchCandidatePreflightError {
  if (error.cause instanceof SearchCandidatePreflightError) {
    return error.cause;
  }
  if (
    error.code === 'link_network_unreachable' &&
    error.cause instanceof Error &&
    error.cause.name === 'AbortError'
  ) {
    return new SearchCandidatePreflightError('candidate_timeout', true);
  }
  switch (error.code) {
    case 'link_invalid_url':
    case 'link_blocked_host':
      return new SearchCandidatePreflightError(
        'candidate_blocked_address',
        false,
      );
    case 'fake_ip_dns_detected':
      return new SearchCandidatePreflightError(
        'candidate_fake_ip_dns_detected',
        false,
      );
    case 'link_access_blocked':
      return new SearchCandidatePreflightError('candidate_http_blocked', false);
    case 'link_rate_limited':
      return new SearchCandidatePreflightError('candidate_rate_limited', true);
    case 'link_no_extractable_content':
      return new SearchCandidatePreflightError(
        'candidate_empty_content',
        false,
      );
    case 'link_unsupported_format':
      return new SearchCandidatePreflightError(
        'candidate_unsupported_format',
        false,
      );
    case 'link_page_too_large':
      return new SearchCandidatePreflightError('candidate_too_large', false);
    case 'link_network_unreachable':
      return new SearchCandidatePreflightError('candidate_network_error', true);
  }
}

/** 使用与正式导入相同的 SSRF/重定向/大小边界执行候选预检，但不持久化或分配引用号。 */
export async function preflightSearchCandidate(
  result: SearchResult,
  signal?: AbortSignal,
  options: Pick<
    FetchWebPageOptions,
    'connector' | 'request' | 'resolveHostname'
  > = {},
): Promise<CandidatePreflightSuccess> {
  try {
    const connector = options.connector ?? nodeWebPageConnector;
    const page = await fetchWebPage(result.url, {
      ...options,
      allowEmptyText: true,
      connector: async (url, init, approvedAddresses) => {
        const connection = await connector(url, init, approvedAddresses);
        if (
          connection.response.status >= 400 &&
          ![401, 403, 429, 451].includes(connection.response.status)
        ) {
          await connection.response.body?.cancel().catch(() => undefined);
          throw new SearchCandidatePreflightError(
            'candidate_http_error',
            connection.response.status >= 500,
          );
        }
        return connection;
      },
      signal,
      request: async (input, init) => {
        const response = await (options.request ?? fetch)(input, {
          ...init,
          signal: combineSignals(init?.signal, signal),
        });
        if (
          response.status >= 400 &&
          ![401, 403, 429, 451].includes(response.status)
        ) {
          throw new SearchCandidatePreflightError(
            'candidate_http_error',
            response.status >= 500,
          );
        }
        return response;
      },
    });
    const html = new TextDecoder().decode(page.bytes);
    if (isLoginWall(html, page.title, page.text.length)) {
      throw new SearchCandidatePreflightError('candidate_login_wall', false);
    }
    if (!page.text.trim()) {
      throw new SearchCandidatePreflightError(
        hasClientRenderShell(html)
          ? 'candidate_render_required'
          : 'candidate_empty_content',
        false,
      );
    }
    const finalUrl = normalizePublicSearchResultUrl(page.finalUrl);
    if (!finalUrl) {
      throw new SearchCandidatePreflightError(
        'candidate_blocked_address',
        false,
      );
    }
    return {
      finalUrl,
      title: page.title,
      contentType: page.contentType,
      textLength: page.text.length,
    };
  } catch (error) {
    if (error instanceof SearchCandidatePreflightError) throw error;
    if (error instanceof WebPageError) throw mapWebPageError(error);
    if (signal?.aborted) {
      throw new SearchCandidatePreflightError('candidate_timeout', true);
    }
    throw new SearchCandidatePreflightError('candidate_network_error', true);
  }
}
