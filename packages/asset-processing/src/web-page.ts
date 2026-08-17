import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export const WEB_PAGE_DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
export const WEB_PAGE_DEFAULT_TIMEOUT_MS = 10_000;
export const WEB_PAGE_MAX_REDIRECTS = 5;
export const WEB_PAGE_MAX_TEXT_CHARACTERS = 120_000;

export const webPageFailureCodes = [
  'link_invalid_url',
  'link_blocked_host',
  'link_network_unreachable',
  'link_access_blocked',
  'link_rate_limited',
  'link_page_too_large',
  'link_no_extractable_content',
  'link_unsupported_format',
] as const;

export type WebPageFailureCode = (typeof webPageFailureCodes)[number];

export class WebPageError extends Error {
  override readonly name = 'WebPageError';

  constructor(
    readonly code: WebPageFailureCode,
    options?: { cause?: unknown },
  ) {
    super(code, options);
  }
}

export interface ReadableHtml {
  title: string | null;
  summary: string;
  text: string;
}

export interface FetchedWebPage extends ReadableHtml {
  requestedUrl: string;
  finalUrl: string;
  contentType: string;
  bytes: Uint8Array;
  fetchedAt: Date;
}

type Request = (
  input: string | URL | globalThis.Request,
  init?: RequestInit,
) => Promise<Response>;

export interface FetchWebPageOptions {
  request?: Request;
  resolveHostname?: (hostname: string) => Promise<readonly string[]>;
  maxBytes?: number;
  timeoutMs?: number;
  now?: () => Date;
  /** Import keeps an empty JS shell so the Worker can render it; preview stays strict. */
  allowEmptyText?: boolean;
}

export interface FetchedWebScript {
  finalUrl: string;
  contentType: string;
  bytes: Uint8Array;
}

function parsePublicHttpUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new WebPageError('link_invalid_url');
  }
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.username !== '' ||
    url.password !== '' ||
    !url.hostname ||
    url.hostname.toLowerCase().endsWith('.local') ||
    (url.port !== '' && url.port !== '80' && url.port !== '443')
  ) {
    throw new WebPageError('link_invalid_url');
  }
  url.hash = '';
  return url;
}

function ipv4Number(address: string): number {
  return address
    .split('.')
    .reduce((value, part) => value * 256 + Number(part), 0);
}

function ipv4InCidr(address: string, base: string, bits: number): boolean {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ipv4Number(address) & mask) === (ipv4Number(base) & mask);
}

/** Reject non-routable, private, metadata and documentation ranges. */
export function isPublicIpAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    return ![
      ['0.0.0.0', 8],
      ['10.0.0.0', 8],
      ['100.64.0.0', 10],
      ['127.0.0.0', 8],
      ['169.254.0.0', 16],
      ['172.16.0.0', 12],
      ['192.0.0.0', 24],
      ['192.0.2.0', 24],
      ['192.168.0.0', 16],
      ['198.18.0.0', 15],
      ['198.51.100.0', 24],
      ['203.0.113.0', 24],
      ['224.0.0.0', 4],
      ['240.0.0.0', 4],
    ].some(([base, bits]) => ipv4InCidr(address, String(base), Number(bits)));
  }
  if (family === 6) {
    const normalized = address.toLowerCase();
    if (normalized === '::' || normalized === '::1') return false;
    if (normalized.startsWith('::ffff:')) {
      const mapped = normalized.slice('::ffff:'.length);
      if (isIP(mapped) === 4) return isPublicIpAddress(mapped);
      const words = mapped.split(':');
      if (words.length === 2) {
        const high = Number.parseInt(words[0]!, 16);
        const low = Number.parseInt(words[1]!, 16);
        if (
          Number.isInteger(high) &&
          Number.isInteger(low) &&
          high >= 0 &&
          high <= 0xffff &&
          low >= 0 &&
          low <= 0xffff
        ) {
          return isPublicIpAddress(
            `${high >>> 8}.${high & 0xff}.${low >>> 8}.${low & 0xff}`,
          );
        }
      }
      return false;
    }
    return !(
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') ||
      /^fe[89ab]/u.test(normalized) ||
      /^fe[c-f]/u.test(normalized) ||
      normalized.startsWith('ff') ||
      normalized.startsWith('2001:db8:')
    );
  }
  return false;
}

async function assertPublicHost(
  url: URL,
  resolveHostname: (hostname: string) => Promise<readonly string[]>,
): Promise<void> {
  if (url.hostname.toLowerCase() === 'localhost') {
    throw new WebPageError('link_blocked_host');
  }
  let addresses: readonly string[];
  try {
    addresses = isIP(url.hostname)
      ? [url.hostname]
      : await resolveHostname(url.hostname);
  } catch (cause) {
    throw new WebPageError('link_network_unreachable', { cause });
  }
  if (
    addresses.length === 0 ||
    addresses.some((address) => !isPublicIpAddress(address))
  ) {
    throw new WebPageError('link_blocked_host');
  }
}

/** Validate URL syntax plus every DNS answer immediately before a network hop. */
export async function assertPublicWebUrl(
  value: string,
  resolveHostname: (
    hostname: string,
  ) => Promise<readonly string[]> = defaultResolveHostname,
): Promise<URL> {
  const url = parsePublicHttpUrl(value);
  await assertPublicHost(url, resolveHostname);
  return url;
}

async function readBoundedBody(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array> {
  const declared = response.headers.get('content-length');
  if (declared !== null && Number(declared) > maxBytes) {
    throw new WebPageError('link_page_too_large');
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new WebPageError('link_page_too_large');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

const HTML_ENTITY_MAP: Readonly<Record<string, string>> = {
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  nbsp: ' ',
  quot: '"',
};

function decodeHtmlEntities(value: string): string {
  return value.replace(
    /&(?:#(\d+)|#x([\da-f]+)|([a-z]+));/giu,
    (matched, decimal: string, hexadecimal: string, named: string) => {
      if (decimal) return String.fromCodePoint(Number(decimal));
      if (hexadecimal)
        return String.fromCodePoint(Number.parseInt(hexadecimal, 16));
      return HTML_ENTITY_MAP[named.toLowerCase()] ?? matched;
    },
  );
}

function normalizeReadableText(value: string): string {
  return decodeHtmlEntities(value)
    .normalize('NFC')
    .replace(/\u0000/gu, '')
    .replace(/[ \t]+/gu, ' ')
    .replace(/ *\n */gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}

/** Dependency-free conservative HTML extraction for worker and preview paths. */
export function extractReadableHtml(
  html: string,
  options: { allowEmptyText?: boolean } = {},
): ReadableHtml {
  const titleMatch = /<title(?:\s[^>]*)?>([\s\S]*?)<\/title>/iu.exec(html);
  const title = titleMatch
    ? normalizeReadableText(titleMatch[1]!.replace(/<[^>]*>/gu, ' ')).slice(
        0,
        300,
      ) || null
    : null;
  const withoutNoise = html
    .replace(/<!--[\s\S]*?-->/gu, ' ')
    .replace(
      /<(script|style|noscript|svg|canvas|template)(?:\s[^>]*)?>[\s\S]*?<\/\1>/giu,
      ' ',
    )
    .replace(/<(nav|footer|aside)(?:\s[^>]*)?>[\s\S]*?<\/\1>/giu, ' ')
    .replace(/<(?:br|\/p|\/div|\/li|\/h[1-6]|\/article|\/section)>/giu, '\n')
    .replace(/<[^>]+>/gu, ' ');
  const text = [...normalizeReadableText(withoutNoise)]
    .slice(0, WEB_PAGE_MAX_TEXT_CHARACTERS)
    .join('');
  if (!text && !options.allowEmptyText) {
    throw new WebPageError('link_no_extractable_content');
  }
  return { title, summary: [...text].slice(0, 280).join(''), text };
}

async function defaultResolveHostname(hostname: string): Promise<string[]> {
  return (await lookup(hostname, { all: true, verbatim: true })).map(
    (entry) => entry.address,
  );
}

export async function fetchWebPage(
  requestedUrl: string,
  options: FetchWebPageOptions = {},
): Promise<FetchedWebPage> {
  const request = options.request ?? fetch;
  const resolveHostname = options.resolveHostname ?? defaultResolveHostname;
  const maxBytes = options.maxBytes ?? WEB_PAGE_DEFAULT_MAX_BYTES;
  const timeoutMs = options.timeoutMs ?? WEB_PAGE_DEFAULT_TIMEOUT_MS;
  const requested = parsePublicHttpUrl(requestedUrl);
  let current = requested;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    for (let redirect = 0; redirect <= WEB_PAGE_MAX_REDIRECTS; redirect += 1) {
      await assertPublicHost(current, resolveHostname);
      let response: Response;
      try {
        response = await request(current, {
          method: 'GET',
          redirect: 'manual',
          signal: abort.signal,
          headers: {
            accept: 'text/html,application/xhtml+xml;q=0.9',
            'user-agent': 'EduCanvas-WebImporter/1.0',
          },
        });
      } catch (cause) {
        throw new WebPageError('link_network_unreachable', { cause });
      }
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        if (!location || redirect === WEB_PAGE_MAX_REDIRECTS) {
          throw new WebPageError('link_network_unreachable');
        }
        current = parsePublicHttpUrl(new URL(location, current).toString());
        continue;
      }
      if ([401, 403, 451].includes(response.status)) {
        throw new WebPageError('link_access_blocked');
      }
      if (response.status === 429) throw new WebPageError('link_rate_limited');
      if (!response.ok) throw new WebPageError('link_network_unreachable');
      const contentType = response.headers
        .get('content-type')
        ?.split(';', 1)[0]
        ?.trim()
        .toLowerCase();
      if (
        contentType !== 'text/html' &&
        contentType !== 'application/xhtml+xml'
      ) {
        throw new WebPageError('link_unsupported_format');
      }
      const bytes = await readBoundedBody(response, maxBytes);
      const readable = extractReadableHtml(new TextDecoder().decode(bytes), {
        allowEmptyText: options.allowEmptyText,
      });
      return {
        requestedUrl: requested.toString(),
        finalUrl: current.toString(),
        contentType,
        bytes,
        fetchedAt: options.now?.() ?? new Date(),
        ...readable,
      };
    }
    throw new WebPageError('link_network_unreachable');
  } finally {
    clearTimeout(timer);
  }
}

const WEB_SCRIPT_CONTENT_TYPES = new Set([
  'application/ecmascript',
  'application/javascript',
  'application/x-javascript',
  'text/ecmascript',
  'text/javascript',
]);

/** Fetches one script through the same SSRF, redirect, timeout and byte guards as page import. */
export async function fetchPublicWebScript(
  requestedUrl: string,
  options: Omit<FetchWebPageOptions, 'allowEmptyText' | 'now'> = {},
): Promise<FetchedWebScript> {
  const request = options.request ?? fetch;
  const resolveHostname = options.resolveHostname ?? defaultResolveHostname;
  const maxBytes = options.maxBytes ?? 512 * 1024;
  const timeoutMs = options.timeoutMs ?? WEB_PAGE_DEFAULT_TIMEOUT_MS;
  let current = parsePublicHttpUrl(requestedUrl);
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    for (let redirect = 0; redirect <= WEB_PAGE_MAX_REDIRECTS; redirect += 1) {
      await assertPublicHost(current, resolveHostname);
      let response: Response;
      try {
        response = await request(current, {
          method: 'GET',
          redirect: 'manual',
          signal: abort.signal,
          headers: {
            accept: 'text/javascript,application/javascript;q=0.9',
            'user-agent': 'EduCanvas-WebImporter/1.0',
          },
        });
      } catch (cause) {
        throw new WebPageError('link_network_unreachable', { cause });
      }
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        if (!location || redirect === WEB_PAGE_MAX_REDIRECTS) {
          throw new WebPageError('link_network_unreachable');
        }
        current = parsePublicHttpUrl(new URL(location, current).toString());
        continue;
      }
      if ([401, 403, 451].includes(response.status)) {
        throw new WebPageError('link_access_blocked');
      }
      if (response.status === 429) throw new WebPageError('link_rate_limited');
      if (!response.ok) throw new WebPageError('link_network_unreachable');
      const contentType = response.headers
        .get('content-type')
        ?.split(';', 1)[0]
        ?.trim()
        .toLowerCase();
      if (!contentType || !WEB_SCRIPT_CONTENT_TYPES.has(contentType)) {
        throw new WebPageError('link_unsupported_format');
      }
      return {
        finalUrl: current.toString(),
        contentType,
        bytes: await readBoundedBody(response, maxBytes),
      };
    }
    throw new WebPageError('link_network_unreachable');
  } finally {
    clearTimeout(timer);
  }
}
