import 'server-only';

import type { AgentTool } from '@educanvas/agent-runtime';
import { z } from 'zod';

/**
 * 网页搜索工具(M3b,Tavily REST 起步)。组合根适配器:API Key 只在本文件
 * 使用;未配置 SEARCH_API_KEY 时返回 null → 工具不注册,通用 turn 行为与
 * 无工具时完全一致(诚实降级,不伪装联网)。
 * 成本护栏:单次调用、最多 5 条结果、摘要截断、10s 超时——先到先得,
 * 配额策略等真实拥塞再设计(与 ADR-0012 同一取向)。
 */

const searchInputSchema = z
  .object({
    query: z.string().trim().min(1).max(200),
  })
  .strict();

const searchOutputSchema = z
  .object({
    results: z
      .array(
        z
          .object({
            title: z.string().max(200),
            url: z.string().max(1024),
            snippet: z.string().max(400),
          })
          .strict(),
      )
      .max(5),
  })
  .strict();

const tavilyResponseSchema = z
  .object({
    results: z
      .array(
        z
          .object({
            title: z.string().optional(),
            url: z.string(),
            content: z.string().optional(),
          })
          .loose(),
      )
      .optional(),
  })
  .loose();

const clip = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

export function resolveWebSearchTool(
  fetchImpl: typeof fetch = fetch,
): AgentTool<
  z.infer<typeof searchInputSchema>,
  z.infer<typeof searchOutputSchema>
> | null {
  const apiKey = process.env.SEARCH_API_KEY?.trim();
  if (!apiKey) return null;
  const baseUrl =
    process.env.SEARCH_BASE_URL?.trim() || 'https://api.tavily.com';

  return {
    name: 'webSearch',
    description:
      '搜索互联网获取时效性信息。输入检索词,返回最多5条结果(标题、链接、摘要)。',
    inputSchema: searchInputSchema,
    outputSchema: searchOutputSchema,
    timeoutMs: 10_000,
    handler: async (input) => {
      const response = await fetchImpl(`${baseUrl}/search`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          api_key: apiKey,
          query: input.query,
          max_results: 5,
          include_answer: false,
          include_raw_content: false,
        }),
      });
      if (!response.ok) {
        throw new Error(`search_provider_${response.status}`);
      }
      const payload = tavilyResponseSchema.parse(await response.json());
      return {
        results: (payload.results ?? []).slice(0, 5).map((result) => ({
          title: clip(result.title?.trim() || result.url, 200),
          url: clip(result.url, 1024),
          snippet: clip((result.content ?? '').trim(), 400),
        })),
      };
    },
  };
}
