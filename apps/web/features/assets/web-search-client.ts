import { z } from 'zod';

export const webSearchResultSchema = z
  .object({
    title: z.string().min(1).max(200),
    url: z.url().max(1024),
    domain: z.string().min(1).max(255),
    snippet: z.string().max(400),
    accessibility: z.enum(['unchecked', 'accessible', 'unavailable']),
    imported: z.boolean(),
  })
  .strict();

export type WebSearchResult = z.infer<typeof webSearchResultSchema>;

const webSearchResponseSchema = z
  .object({ results: z.array(webSearchResultSchema).max(10) })
  .strict();

const webSearchErrorSchema = z
  .object({
    error: z.object({
      code: z.string(),
      message: z.string().optional(),
      retryable: z.boolean().optional(),
    }),
  })
  .strict();

export class WebSearchClientError extends Error {
  override readonly name = 'WebSearchClientError';

  constructor(
    readonly code: string,
    readonly retryable: boolean,
    message: string,
  ) {
    super(message);
  }
}

export async function searchWebSources(
  query: string,
  endpoint = '/api/v1/chat/assets/link/search',
): Promise<readonly WebSearchResult[]> {
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: query.trim() }),
    });
  } catch {
    throw new WebSearchClientError(
      'search_network_error',
      true,
      '无法连接网页搜索。请检查网络后重试。',
    );
  }

  if (!response.ok) {
    const parsed = webSearchErrorSchema.safeParse(
      await response.json().catch(() => null),
    );
    throw new WebSearchClientError(
      parsed.success ? parsed.data.error.code : 'search_unavailable',
      parsed.success
        ? (parsed.data.error.retryable ?? response.status >= 500)
        : true,
      parsed.success && parsed.data.error.message
        ? parsed.data.error.message
        : '网页搜索暂时不可用。请稍后重试。',
    );
  }

  const parsed = webSearchResponseSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new WebSearchClientError(
      'search_invalid_response',
      true,
      '网页搜索结果格式不正确。请重试。',
    );
  }
  return parsed.data.results;
}
