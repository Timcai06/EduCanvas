import 'server-only';

import type { AgentTool } from '@educanvas/agent-runtime';
import {
  WebPageError,
  fetchWebPage as fetchSafeWebPage,
  type FetchWebPageOptions,
} from '@educanvas/asset-processing';
import { nodeWebPageConnector } from '@educanvas/asset-processing/node';
import { z } from 'zod';
import {
  linkTrafficLimiter,
  type LinkTrafficLease,
} from '../assets/link-traffic-limiter';

/**
 * 安全网页抓取核心(M3b-C)。服务端替用户/模型取回公开网页并抽取正文,
 * 同时是 fetchWebPage 工具与"链接导入为来源"的共享底座。
 *
 * SSRF 防线(纵深一:主机名规则):只允许 http/https 默认端口,拒绝 IP 直连
 * 内网段、localhost、.local 与带凭据 URL;重定向手动跟随且每跳重检。
 * Node 组合根使用 DNS 固定连接器，把 socket 绑定到刚审核的解析结果，并核对
 * 实际 peer；自定义测试传输也必须显式实现同一 connector 契约。
 */

const MAX_TEXT_CHARS = 60_000;

export class WebPageFetchError extends Error {
  constructor(
    readonly code:
      | 'invalid_url'
      | 'blocked_host'
      | 'fetch_failed'
      | 'unsupported_content'
      | 'too_large'
      | 'fake_ip_dns_detected',
  ) {
    super(code);
    this.name = 'WebPageFetchError';
  }
}

const decodeEntities = (text: string): string =>
  text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

/** 无依赖的 HTML→正文抽取:去脚本样式、块级断行、实体解码、空白收敛。 */
export function extractReadableText(html: string): {
  title: string | null;
  text: string;
} {
  const title = /<title[^>]*>([^<]{1,300})<\/title>/i.exec(html)?.[1];
  const text = decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(p|div|br|li|h[1-6]|tr|section|article)[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t\r]+/g, ' ')
    .replace(/\n\s*\n\s*/g, '\n')
    .trim();
  return {
    title: title ? decodeEntities(title.trim()) || null : null,
    text: [...text].slice(0, MAX_TEXT_CHARS).join(''),
  };
}

export interface FetchedWebPage {
  requestedUrl: string;
  url: string;
  title: string | null;
  text: string;
  bytes: Uint8Array;
  contentType: string;
  fetchedAt: Date;
}

export async function fetchReadableWebPage(
  rawUrl: string,
  fetchImpl: typeof fetch = fetch,
  resolveHostname?: FetchWebPageOptions['resolveHostname'],
  connector: FetchWebPageOptions['connector'] = nodeWebPageConnector,
): Promise<FetchedWebPage> {
  try {
    const page = await fetchSafeWebPage(rawUrl, {
      request: fetchImpl,
      connector,
      ...(resolveHostname ? { resolveHostname } : {}),
    });
    return {
      requestedUrl: page.requestedUrl,
      url: page.finalUrl,
      title: page.title,
      text: [...page.text].slice(0, MAX_TEXT_CHARS).join(''),
      bytes: page.bytes,
      contentType: page.contentType,
      fetchedAt: page.fetchedAt,
    };
  } catch (error) {
    if (!(error instanceof WebPageError)) throw error;
    const code =
      error.code === 'link_invalid_url'
        ? 'invalid_url'
        : error.code === 'link_blocked_host'
          ? 'blocked_host'
          : error.code === 'fake_ip_dns_detected'
            ? 'fake_ip_dns_detected'
            : error.code === 'link_page_too_large'
              ? 'too_large'
              : error.code === 'link_no_extractable_content' ||
                  error.code === 'link_unsupported_format'
                ? 'unsupported_content'
                : 'fetch_failed';
    throw new WebPageFetchError(code);
  }
}

const fetchPageInputSchema = z
  .object({ url: z.string().trim().min(8).max(1024) })
  .strict();

const fetchPageOutputSchema = z
  .object({
    url: z.string().max(1024),
    title: z.string().max(300).nullable(),
    content: z.string().max(8_000),
    /** 组合根持久化成功后分配；模型必须用对应 [n] 标记引用。 */
    citationMarker: z.number().int().min(1).max(99).optional(),
  })
  .strict();

export type WebPageFetchedHook = (
  page: FetchedWebPage,
) => Promise<{ citationMarker: number } | undefined>;

/** 读网页工具:无外部 Key 依赖,恒可注册;in-turn 内容截断以护上下文预算。 */
export function createFetchWebPageTool(
  fetchImpl: typeof fetch = fetch,
  onFetched?: WebPageFetchedHook,
  resolveHostname?: FetchWebPageOptions['resolveHostname'],
  connector?: FetchWebPageOptions['connector'],
  trafficKey?: string,
): AgentTool<
  z.infer<typeof fetchPageInputSchema>,
  z.infer<typeof fetchPageOutputSchema>
> {
  return {
    name: 'fetchWebPage',
    description:
      '读取一个公开网页并返回其正文文本(截断至8000字符)。用于查看搜索结果或用户给出的链接；若返回 citationMarker，引用该网页时必须在正文使用对应的 [n]。',
    inputSchema: fetchPageInputSchema,
    outputSchema: fetchPageOutputSchema,
    timeoutMs: 12_000,
    handler: async (input) => {
      let trafficLease: LinkTrafficLease | undefined;
      try {
        if (trafficKey) {
          const acquired = linkTrafficLimiter.acquire(trafficKey);
          if (!acquired.allowed) throw new WebPageFetchError('fetch_failed');
          trafficLease = acquired;
        }
        const page = await fetchReadableWebPage(
          input.url,
          fetchImpl,
          resolveHostname,
          connector,
        );
        const persisted = await onFetched?.(page);
        return {
          url: page.url,
          title: page.title,
          content: [...page.text].slice(0, 8_000).join(''),
          ...persisted,
        };
      } finally {
        trafficLease?.release();
      }
    },
  };
}
