import 'server-only';

import type { AgentTool } from '@educanvas/agent-runtime';
import { z } from 'zod';

/**
 * 安全网页抓取核心(M3b-C)。服务端替用户/模型取回公开网页并抽取正文,
 * 同时是 fetchWebPage 工具与"链接导入为来源"的共享底座。
 *
 * SSRF 防线(纵深一:主机名规则):只允许 http/https 默认端口,拒绝 IP 直连
 * 内网段、localhost、.local 与带凭据 URL;重定向手动跟随且每跳重检。
 * 已知残余风险:DNS 重绑定需在网络层(独立出口/代理)治理,属 production
 * hardening 非目标,在此明示不伪装已解决。
 */

const MAX_PAGE_BYTES = 2 * 1024 * 1024;
const MAX_TEXT_CHARS = 60_000;
const MAX_REDIRECTS = 3;
const FETCH_TIMEOUT_MS = 10_000;

export class WebPageFetchError extends Error {
  constructor(
    readonly code:
      | 'invalid_url'
      | 'blocked_host'
      | 'fetch_failed'
      | 'unsupported_content'
      | 'too_large',
  ) {
    super(code);
    this.name = 'WebPageFetchError';
  }
}

const PRIVATE_HOST_PATTERNS: readonly RegExp[] = [
  /^localhost$/i,
  /\.local$/i,
  /^127\./,
  /^0\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /^\[?::1\]?$/,
  /^\[?f[cd][0-9a-f]{2}:/i,
  /^\[?fe80:/i,
];

function assertPublicHttpUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new WebPageFetchError('invalid_url');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new WebPageFetchError('invalid_url');
  }
  if (url.username || url.password) throw new WebPageFetchError('invalid_url');
  if (url.port && url.port !== '80' && url.port !== '443') {
    throw new WebPageFetchError('blocked_host');
  }
  const host = url.hostname;
  if (PRIVATE_HOST_PATTERNS.some((pattern) => pattern.test(host))) {
    throw new WebPageFetchError('blocked_host');
  }
  return url;
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
  url: string;
  title: string | null;
  text: string;
}

export async function fetchReadableWebPage(
  rawUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<FetchedWebPage> {
  let url = assertPublicHttpUrl(rawUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    let response: Response | null = null;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const attempt = await fetchImpl(url.toString(), {
        redirect: 'manual',
        signal: controller.signal,
        headers: { accept: 'text/html,text/plain;q=0.9' },
      }).catch(() => {
        throw new WebPageFetchError('fetch_failed');
      });
      if ([301, 302, 303, 307, 308].includes(attempt.status)) {
        const location = attempt.headers.get('location');
        await attempt.body?.cancel().catch(() => undefined);
        if (!location || hop === MAX_REDIRECTS) {
          throw new WebPageFetchError('fetch_failed');
        }
        /* 每一跳都重过公网校验,重定向不能落进内网 */
        url = assertPublicHttpUrl(new URL(location, url).toString());
        continue;
      }
      response = attempt;
      break;
    }
    if (!response || !response.ok) throw new WebPageFetchError('fetch_failed');

    const contentType =
      response.headers.get('content-type')?.toLowerCase() ?? '';
    if (
      !contentType.includes('text/html') &&
      !contentType.includes('text/plain')
    ) {
      await response.body?.cancel().catch(() => undefined);
      throw new WebPageFetchError('unsupported_content');
    }
    const declaredLength = Number(
      response.headers.get('content-length') ?? '0',
    );
    if (declaredLength > MAX_PAGE_BYTES) {
      await response.body?.cancel().catch(() => undefined);
      throw new WebPageFetchError('too_large');
    }
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_PAGE_BYTES) {
      throw new WebPageFetchError('too_large');
    }
    const html = new TextDecoder('utf-8', { fatal: false }).decode(buffer);
    const { title, text } = contentType.includes('text/plain')
      ? { title: null, text: [...html].slice(0, MAX_TEXT_CHARS).join('') }
      : extractReadableText(html);
    if (!text) throw new WebPageFetchError('unsupported_content');
    return { url: url.toString(), title, text };
  } finally {
    clearTimeout(timer);
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
      const page = await fetchReadableWebPage(input.url, fetchImpl);
      const persisted = await onFetched?.(page);
      return {
        url: page.url,
        title: page.title,
        content: [...page.text].slice(0, 8_000).join(''),
        ...persisted,
      };
    },
  };
}
