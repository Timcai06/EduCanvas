import 'server-only';

import { z } from 'zod';

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchProvider {
  search(input: {
    query: string;
    limit: number;
  }): Promise<{ results: readonly SearchResult[] }>;
}

const tavilyResponseSchema = z.object({
  results: z
    .array(
      z.object({
        title: z.string().optional(),
        url: z.string(),
        content: z.string().optional(),
      }),
    )
    .optional(),
});

const clip = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

function normalizePublicResultUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password
    ) {
      return null;
    }
    const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
    if (
      hostname === 'localhost' ||
      hostname.endsWith('.localhost') ||
      hostname === '0.0.0.0' ||
      hostname === '::1' ||
      /^127\./.test(hostname) ||
      /^10\./.test(hostname) ||
      /^192\.168\./.test(hostname) ||
      /^169\.254\./.test(hostname) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
    ) {
      return null;
    }
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

/** Tavily wire data and credentials remain behind this server-only adapter. */
export function createTavilySearchProvider(input: {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}): SearchProvider {
  const fetchImpl = input.fetchImpl ?? fetch;
  const baseUrl = input.baseUrl?.trim() || 'https://api.tavily.com';
  return {
    async search({ query, limit }) {
      const response = await fetchImpl(`${baseUrl}/search`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          api_key: input.apiKey,
          query,
          max_results: Math.min(5, limit),
          include_answer: false,
          include_raw_content: false,
        }),
      });
      if (!response.ok) throw new Error(`search_provider_${response.status}`);
      const payload = tavilyResponseSchema.parse(await response.json());
      const seen = new Set<string>();
      const results: SearchResult[] = [];
      for (const result of payload.results ?? []) {
        const url = normalizePublicResultUrl(result.url);
        if (!url || seen.has(url)) continue;
        seen.add(url);
        results.push({
          title: clip(result.title?.trim() || url, 200),
          url: clip(url, 1024),
          snippet: clip((result.content ?? '').trim(), 400),
        });
        if (results.length >= Math.min(5, limit)) break;
      }
      return { results };
    },
  };
}
