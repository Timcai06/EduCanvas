import { readAnonymousIdentity } from '@/server/identity/anonymous-identity';
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
  resolveSearchService,
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
  search_not_configured: {
    status: 503,
    message: '网页搜索尚未配置。请改用网页地址导入。',
  },
  search_timeout: {
    status: 504,
    message: '网页搜索超时。请重试或缩短检索词。',
  },
  search_rate_limited: {
    status: 429,
    message: '网页搜索请求过于频繁。请稍后重试。',
  },
  search_provider_unavailable: {
    status: 503,
    message: '网页搜索暂时不可用。请稍后重试。',
  },
  search_invalid_response: {
    status: 502,
    message: '网页搜索返回了无效结果。请重试。',
  },
  search_budget_exhausted: {
    status: 504,
    message: '网页搜索未能在限定时间内完成。请重试。',
  },
  search_cancelled: {
    status: 499,
    message: '网页搜索已取消。',
  },
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
  message: string,
  retryable: boolean,
): Response {
  return jsonResponse({ error: { code, message, retryable } }, { status });
}

/** 浏览器搜索只接收 Provider-neutral 投影；Provider 身份、健康和原始响应留在服务端。 */
export async function POST(request: Request): Promise<Response> {
  if (!isTrustedSameOriginWrite(request)) {
    return jsonError(403, 'forbidden_origin', '请求来源不受信任。');
  }
  const identity = await readAnonymousIdentity();
  if (!identity) return jsonError(401, 'unauthorized', '请先开始对话。');
  const conversation = await loadOwnedGeneralConversation(identity);
  if (!conversation) return jsonError(401, 'unauthorized', '请先开始对话。');

  let body: unknown;
  try {
    body = await readLimitedJsonRequest(request);
  } catch (error) {
    if (error instanceof JsonRequestValidationError) {
      return jsonRequestErrorResponse(error);
    }
    throw error;
  }
  const parsed = searchRequestSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(
      400,
      'search_invalid_query',
      '检索词需包含 2 到 200 个字符。',
    );
  }

  const service = resolveSearchService(environment());
  if (!service) {
    const failure = publicError.search_not_configured;
    return searchError(
      failure.status,
      'search_not_configured',
      failure.message,
      false,
    );
  }

  try {
    const output = await service.search(
      {
        query: parsed.data.query,
        limit: 10,
      },
      request.signal,
    );
    return jsonResponse({
      results: output.results.map((result) => ({
        title: result.title,
        url: result.url,
        domain: result.sourceDomain ?? new URL(result.url).hostname,
        snippet: result.snippet,
        accessibility: 'unchecked' as const,
        imported: false,
      })),
    });
  } catch (error) {
    if (error instanceof SearchServiceError) {
      const failure = publicError[error.code];
      return searchError(
        failure.status,
        error.code,
        failure.message,
        error.retryable,
      );
    }
    return searchError(
      503,
      'search_provider_unavailable',
      publicError.search_provider_unavailable.message,
      true,
    );
  }
}
