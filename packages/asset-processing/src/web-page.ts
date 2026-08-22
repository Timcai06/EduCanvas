import { isIP } from 'node:net';
import { extractReadableHtml, type ReadableHtml } from './web-page-extraction';
import {
  createCombinedAbortSignal,
  discardResponse,
  readBoundedBody,
} from './web-page-response';

import {
  WebPageError,
  assertPublicHost,
  defaultResolveHostname,
  isPublicIpAddress,
  normalizeIpAddress,
  parsePublicHttpUrl,
} from './web-page-security';

export {
  WebPageError,
  assertPublicWebUrl,
  isFakeIpAddress,
  isPublicIpAddress,
  webPageFailureCodes,
  type WebPageFailureCode,
} from './web-page-security';
export {
  WEB_PAGE_MAX_TEXT_CHARACTERS,
  extractReadableHtml,
  type ReadableHtml,
} from './web-page-extraction';

export const WEB_PAGE_DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
export const WEB_PAGE_DEFAULT_TIMEOUT_MS = 10_000;
export const WEB_PAGE_MAX_REDIRECTS = 5;

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

export interface WebPageConnection {
  response: Response;
  connectedAddress: string;
}

/**
 * Performs a request while binding the connection to one of the reviewed DNS answers.
 * Implementations must report the actual peer address after the connection is established.
 */
export type WebPageConnector = (
  url: URL,
  init: RequestInit,
  approvedAddresses: readonly string[],
) => Promise<WebPageConnection>;

export interface FetchWebPageOptions {
  /** Used for direct IP literals; DNS hostnames require a connector. */
  request?: Request;
  /** Required for hostnames so the transport can bind and report the reviewed peer. */
  connector?: WebPageConnector;
  resolveHostname?: (hostname: string) => Promise<readonly string[]>;
  maxBytes?: number;
  timeoutMs?: number;
  now?: () => Date;
  /** Import keeps an empty JS shell so the Worker can render it; preview stays strict. */
  allowEmptyText?: boolean;
  signal?: AbortSignal;
}

export interface FetchedWebScript {
  finalUrl: string;
  contentType: string;
  bytes: Uint8Array;
}

async function performWebPageRequest(
  url: URL,
  init: RequestInit,
  approvedAddresses: readonly string[],
  request: Request,
  connector: WebPageConnector | undefined,
  signal: AbortSignal,
): Promise<Response> {
  if (signal.aborted) {
    throw (
      signal.reason ??
      new DOMException('The operation was aborted', 'AbortError')
    );
  }
  if (!connector) {
    if (isIP(url.hostname) === 0) {
      throw new WebPageError('link_network_unreachable');
    }
    return request(url, init);
  }
  const connection = await new Promise<WebPageConnection>((resolve, reject) => {
    const rejectForAbort = () =>
      reject(
        signal.reason ??
          new DOMException('The operation was aborted', 'AbortError'),
      );
    if (signal.aborted) {
      rejectForAbort();
      return;
    }
    signal.addEventListener('abort', rejectForAbort, { once: true });
    connector(url, init, approvedAddresses)
      .then(resolve, reject)
      .finally(() => {
        signal.removeEventListener('abort', rejectForAbort);
      });
  });
  if (
    !connection ||
    !(connection.response instanceof Response) ||
    typeof connection.connectedAddress !== 'string' ||
    !isPublicIpAddress(connection.connectedAddress) ||
    !approvedAddresses.some(
      (address) =>
        normalizeIpAddress(address) ===
        normalizeIpAddress(connection.connectedAddress),
    )
  ) {
    await connection?.response?.body?.cancel().catch(() => undefined);
    throw new WebPageError('link_blocked_host');
  }
  return connection.response;
}

export async function fetchWebPage(
  requestedUrl: string,
  options: FetchWebPageOptions = {},
): Promise<FetchedWebPage> {
  const request = options.request ?? fetch;
  const connector = options.connector;
  const resolveHostname = options.resolveHostname ?? defaultResolveHostname;
  const maxBytes = options.maxBytes ?? WEB_PAGE_DEFAULT_MAX_BYTES;
  const timeoutMs = options.timeoutMs ?? WEB_PAGE_DEFAULT_TIMEOUT_MS;
  const requested = parsePublicHttpUrl(requestedUrl);
  let current = requested;
  const { signal, cleanup } = createCombinedAbortSignal(
    options.signal,
    timeoutMs,
  );
  try {
    for (let redirect = 0; redirect <= WEB_PAGE_MAX_REDIRECTS; redirect += 1) {
      const approvedAddresses = await assertPublicHost(
        current,
        resolveHostname,
        signal,
      );
      let response: Response;
      try {
        response = await performWebPageRequest(
          current,
          {
            method: 'GET',
            redirect: 'manual',
            signal,
            headers: {
              accept: 'text/html,application/xhtml+xml;q=0.9',
              'user-agent': 'EduCanvas-WebImporter/1.0',
            },
          },
          approvedAddresses,
          request,
          connector,
          signal,
        );
      } catch (cause) {
        if (cause instanceof WebPageError) throw cause;
        throw new WebPageError('link_network_unreachable', { cause });
      }
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        if (!location || redirect === WEB_PAGE_MAX_REDIRECTS) {
          await discardResponse(response);
          throw new WebPageError('link_network_unreachable');
        }
        await discardResponse(response);
        current = parsePublicHttpUrl(new URL(location, current).toString());
        continue;
      }
      if ([401, 403, 451].includes(response.status)) {
        await discardResponse(response);
        throw new WebPageError('link_access_blocked');
      }
      if (response.status === 429) {
        await discardResponse(response);
        throw new WebPageError('link_rate_limited');
      }
      if (!response.ok) {
        await discardResponse(response);
        throw new WebPageError('link_network_unreachable');
      }
      const contentType = response.headers
        .get('content-type')
        ?.split(';', 1)[0]
        ?.trim()
        .toLowerCase();
      if (
        contentType !== 'text/html' &&
        contentType !== 'application/xhtml+xml'
      ) {
        await discardResponse(response);
        throw new WebPageError('link_unsupported_format');
      }
      const bytes = await readBoundedBody(response, maxBytes, signal);
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
    cleanup();
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
  const connector = options.connector;
  const resolveHostname = options.resolveHostname ?? defaultResolveHostname;
  const maxBytes = options.maxBytes ?? 512 * 1024;
  const timeoutMs = options.timeoutMs ?? WEB_PAGE_DEFAULT_TIMEOUT_MS;
  let current = parsePublicHttpUrl(requestedUrl);
  const { signal, cleanup } = createCombinedAbortSignal(
    options.signal,
    timeoutMs,
  );
  try {
    for (let redirect = 0; redirect <= WEB_PAGE_MAX_REDIRECTS; redirect += 1) {
      const approvedAddresses = await assertPublicHost(
        current,
        resolveHostname,
        signal,
      );
      let response: Response;
      try {
        response = await performWebPageRequest(
          current,
          {
            method: 'GET',
            redirect: 'manual',
            signal,
            headers: {
              accept: 'text/javascript,application/javascript;q=0.9',
              'user-agent': 'EduCanvas-WebImporter/1.0',
            },
          },
          approvedAddresses,
          request,
          connector,
          signal,
        );
      } catch (cause) {
        if (cause instanceof WebPageError) throw cause;
        throw new WebPageError('link_network_unreachable', { cause });
      }
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        if (!location || redirect === WEB_PAGE_MAX_REDIRECTS) {
          await discardResponse(response);
          throw new WebPageError('link_network_unreachable');
        }
        await discardResponse(response);
        current = parsePublicHttpUrl(new URL(location, current).toString());
        continue;
      }
      if ([401, 403, 451].includes(response.status)) {
        await discardResponse(response);
        throw new WebPageError('link_access_blocked');
      }
      if (response.status === 429) {
        await discardResponse(response);
        throw new WebPageError('link_rate_limited');
      }
      if (!response.ok) {
        await discardResponse(response);
        throw new WebPageError('link_network_unreachable');
      }
      const contentType = response.headers
        .get('content-type')
        ?.split(';', 1)[0]
        ?.trim()
        .toLowerCase();
      if (!contentType || !WEB_SCRIPT_CONTENT_TYPES.has(contentType)) {
        await discardResponse(response);
        throw new WebPageError('link_unsupported_format');
      }
      return {
        finalUrl: current.toString(),
        contentType,
        bytes: await readBoundedBody(response, maxBytes, signal),
      };
    }
    throw new WebPageError('link_network_unreachable');
  } finally {
    cleanup();
  }
}
