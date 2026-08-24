import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const DEFAULT_DOH_ENDPOINT = 'https://1.1.1.1/dns-query';
const DOH_TIMEOUT_MS = 3_000;
const DOH_MAX_RESPONSE_BYTES = 64 * 1024;

type HostnameLookup = (hostname: string) => Promise<readonly string[]>;
type DnsRequest = (
  input: string | URL | globalThis.Request,
  init?: RequestInit,
) => Promise<Response>;

export interface HostnameResolutionOptions {
  readonly lookupHostname?: HostnameLookup;
  readonly request?: DnsRequest;
  readonly shouldUseFallback: (addresses: readonly string[]) => boolean;
  readonly dohEndpoint?: string;
}

async function systemLookup(hostname: string): Promise<readonly string[]> {
  return (await lookup(hostname, { all: true, verbatim: true })).map(
    (entry) => entry.address,
  );
}

async function readBoundedText(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > DOH_MAX_RESPONSE_BYTES) throw new Error('doh_response_large');
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

async function resolveDohRecord(
  hostname: string,
  type: 'A' | 'AAAA',
  request: DnsRequest,
  endpoint: string,
): Promise<string[]> {
  const url = new URL(endpoint);
  url.searchParams.set('name', hostname);
  url.searchParams.set('type', type);
  const response = await request(url, {
    headers: { accept: 'application/dns-json' },
    cache: 'no-store',
    signal: AbortSignal.timeout(DOH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error('doh_response_failed');
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  if (!contentType.includes('application/dns-json')) {
    throw new Error('doh_content_type_invalid');
  }
  const parsed: unknown = JSON.parse(await readBoundedText(response));
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('Status' in parsed) ||
    parsed.Status !== 0 ||
    !('Answer' in parsed) ||
    !Array.isArray(parsed.Answer)
  ) {
    return [];
  }
  const family = type === 'A' ? 4 : 6;
  return parsed.Answer.flatMap((answer) => {
    if (
      typeof answer !== 'object' ||
      answer === null ||
      !('data' in answer) ||
      typeof answer.data !== 'string' ||
      isIP(answer.data) !== family
    ) {
      return [];
    }
    return [answer.data];
  });
}

async function resolveWithDoh(
  hostname: string,
  request: DnsRequest,
  endpoint: string,
): Promise<string[]> {
  const settled = await Promise.allSettled([
    resolveDohRecord(hostname, 'A', request, endpoint),
    resolveDohRecord(hostname, 'AAAA', request, endpoint),
  ]);
  return [
    ...new Set(
      settled.flatMap((result) =>
        result.status === 'fulfilled' ? result.value : [],
      ),
    ),
  ];
}

/**
 * Prefer the operating-system resolver. A fixed-IP DoH request is used only
 * when resolution fails or the caller identifies every answer as Fake-IP.
 */
export async function resolveHostnameWithDohFallback(
  hostname: string,
  options: HostnameResolutionOptions,
): Promise<readonly string[]> {
  const lookupHostname = options.lookupHostname ?? systemLookup;
  let systemAddresses: readonly string[] | undefined;
  let systemError: unknown;
  try {
    systemAddresses = await lookupHostname(hostname);
    if (!options.shouldUseFallback(systemAddresses)) return systemAddresses;
  } catch (error) {
    systemError = error;
  }

  const dohAddresses = await resolveWithDoh(
    hostname,
    options.request ?? fetch,
    options.dohEndpoint ?? DEFAULT_DOH_ENDPOINT,
  ).catch(() => []);
  if (dohAddresses.length > 0) return dohAddresses;
  if (systemAddresses) return systemAddresses;
  throw systemError ?? new Error('hostname_resolution_failed');
}
