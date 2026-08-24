import { readAnonymousIdentity } from '@/server/identity/anonymous-identity';
import {
  linkTrafficKey,
  linkTrafficLimiter,
} from '@/server/assets/link-traffic-limiter';
import { loadOwnedGeneralConversation } from '@/server/platform/general-conversation';
import {
  isTrustedSameOriginWrite,
  jsonError,
  jsonResponse,
} from '@/server/http/request-security';
import {
  JsonRequestValidationError,
  jsonRequestErrorResponse,
  readLimitedJsonRequest,
} from '@/server/http/json-request';
import {
  resolveSearchCandidatePipeline,
  type SearchEnvironment,
} from '@/server/tools/web-search';
import { SearchServiceError } from '@/server/tools/search-service';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const searchRequestSchema = z
  .object({ query: z.string().trim().min(2).max(200) })
  .strict();

const publicError = {
  search_not_configured: { status: 503 },
  search_timeout: { status: 504 },
  search_rate_limited: { status: 429 },
  search_provider_unavailable: { status: 503 },
  search_invalid_response: { status: 502 },
  search_budget_exhausted: { status: 504 },
  search_cancelled: { status: 499 },
} as const;

function environment(): SearchEnvironment {
  return {
    SEARCH_API_KEY: process.env.SEARCH_API_KEY,
    SEARCH_BASE_URL: process.env.SEARCH_BASE_URL,
    SEARXNG_BASE_URL: process.env.SEARXNG_BASE_URL,
    SEARXNG_API_KEY: process.env.SEARXNG_API_KEY,
  };
}

function searchError(
  status: number,
  code: string,
  retryAfterMs?: number,
): Response {
  return jsonError(status, code, { retryAfterMs });
}

/** 浏览器搜索只接收 Provider-neutral 投影；Provider 身份、健康和原始响应留在服务端。 */
export async function POST(request: Request): Promise<Response> {
  if (!isTrustedSameOriginWrite(request)) {
    return jsonError(403, 'forbidden_origin');
  }
  let identity;
  let conversation;
  try {
    identity = await readAnonymousIdentity();
    if (!identity) return jsonError(401, 'unauthorized');
    conversation = await loadOwnedGeneralConversation(identity);
    if (!conversation) return jsonError(401, 'unauthorized');
  } catch {
    const failure = publicError.search_provider_unavailable;
    return searchError(failure.status, 'search_provider_unavailable');
  }

  let body: unknown;
  try {
    body = await readLimitedJsonRequest(request);
  } catch (error) {
    if (error instanceof JsonRequestValidationError) {
      return jsonRequestErrorResponse(error);
    }
    const failure = publicError.search_provider_unavailable;
    return searchError(failure.status, 'search_provider_unavailable');
  }
  const parsed = searchRequestSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, 'search_invalid_query');
  }

  let pipeline;
  try {
    pipeline = resolveSearchCandidatePipeline(environment());
  } catch {
    const failure = publicError.search_provider_unavailable;
    return searchError(failure.status, 'search_provider_unavailable');
  }
  if (!pipeline) {
    const failure = publicError.search_not_configured;
    return searchError(failure.status, 'search_not_configured');
  }

  let lease;
  try {
    lease = linkTrafficLimiter.acquire(
      linkTrafficKey(identity.studentId, conversation.spaceId),
    );
    if (!lease.allowed) {
      const failure = publicError.search_rate_limited;
      return searchError(
        failure.status,
        'search_rate_limited',
        lease.retryAfterMs,
      );
    }
    const output = await pipeline.search(
      {
        query: parsed.data.query,
        limit: 10,
      },
      request.signal,
    );
    // Browser discovery remains useful under VPN Fake-IP DNS. These fallback
    // candidates are visibly unchecked and still pass the strict fetch/import
    // boundary before any content is read or persisted.
    const results =
      output.results.length > 0 ? output.results : output.uncheckedResults;
    return jsonResponse({
      results: results.map((result) => ({
        title: result.title,
        url: result.url,
        domain: result.sourceDomain ?? new URL(result.url).hostname,
        snippet: result.snippet,
        accessibility: result.accessibility,
        imported: false,
      })),
    });
  } catch (error) {
    if (error instanceof SearchServiceError) {
      const failure =
        publicError[error.code as keyof typeof publicError] ??
        publicError.search_provider_unavailable;
      const code = Object.hasOwn(publicError, error.code)
        ? error.code
        : 'search_provider_unavailable';
      return searchError(failure.status, code);
    }
    return searchError(503, 'search_provider_unavailable');
  } finally {
    if (lease?.allowed) lease.release();
  }
}
