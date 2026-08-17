import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export const webPageFailureCodes = [
  'link_invalid_url',
  'link_blocked_host',
  'link_network_unreachable',
  'link_access_blocked',
  'link_rate_limited',
  'link_page_too_large',
  'link_no_extractable_content',
  'link_unsupported_format',
  'fake_ip_dns_detected',
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

export function parsePublicHttpUrl(value: string): URL {
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

/** Detect addresses in the benchmark range commonly used by Fake-IP DNS proxies. */
export function isFakeIpAddress(address: string): boolean {
  return isIP(address) === 4 && ipv4InCidr(address, '198.18.0.0', 15);
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

export async function defaultResolveHostname(
  hostname: string,
): Promise<string[]> {
  return (await lookup(hostname, { all: true, verbatim: true })).map(
    (entry) => entry.address,
  );
}

export async function assertPublicHost(
  url: URL,
  resolveHostname: (hostname: string) => Promise<readonly string[]>,
): Promise<void> {
  if (url.hostname.toLowerCase() === 'localhost') {
    throw new WebPageError('link_blocked_host');
  }
  const isIpAddress = isIP(url.hostname) !== 0;
  let addresses: readonly string[];
  try {
    addresses = isIpAddress
      ? [url.hostname]
      : await resolveHostname(url.hostname);
  } catch (cause) {
    throw new WebPageError('link_network_unreachable', { cause });
  }
  if (addresses.length === 0) {
    throw new WebPageError('link_blocked_host');
  }
  // Only DNS-resolved hostnames can diagnose a Fake-IP environment. Direct
  // literals in the benchmark range remain blocked by the SSRF policy.
  if (!isIpAddress && addresses.every((address) => isFakeIpAddress(address))) {
    throw new WebPageError('fake_ip_dns_detected');
  }
  // Mixed Fake-IP and other answers fail closed because no answer is trusted.
  if (addresses.some((address) => !isPublicIpAddress(address))) {
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
