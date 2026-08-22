import http, { type IncomingMessage, type RequestOptions } from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';
import { Readable } from 'node:stream';

import type { WebPageConnection, WebPageConnector } from './web-page';
import { normalizeIpAddress } from './web-page-security';

function normalizePeerAddress(address: string): string {
  return normalizeIpAddress(address) ?? address;
}

function responseBody(
  response: IncomingMessage,
  method: string,
): ReadableStream<Uint8Array> | null {
  if (
    method === 'HEAD' ||
    response.statusCode === 204 ||
    response.statusCode === 304
  ) {
    response.resume();
    return null;
  }
  return Readable.toWeb(response) as ReadableStream<Uint8Array>;
}

function connectToAddress(
  url: URL,
  init: RequestInit,
  address: string,
): Promise<WebPageConnection> {
  return new Promise((resolve, reject) => {
    const method = init.method ?? 'GET';
    const headers = new Headers(init.headers);
    headers.set('host', url.host);
    const options: RequestOptions = {
      protocol: url.protocol,
      hostname: address,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: `${url.pathname}${url.search}`,
      method,
      headers: Object.fromEntries(headers.entries()),
      signal: init.signal ?? undefined,
      ...(url.protocol === 'https:' && isIP(url.hostname) === 0
        ? { servername: url.hostname }
        : {}),
    };
    const request = (url.protocol === 'https:' ? https : http).request(
      options,
      (incoming) => {
        const connectedAddress = incoming.socket.remoteAddress;
        if (!connectedAddress || !incoming.statusCode) {
          incoming.destroy();
          reject(new Error('web_page_peer_unavailable'));
          return;
        }
        const responseHeaders = new Headers();
        for (const [name, value] of Object.entries(incoming.headers)) {
          if (Array.isArray(value)) {
            for (const item of value) responseHeaders.append(name, item);
          } else if (value !== undefined) {
            responseHeaders.set(name, value);
          }
        }
        resolve({
          response: new Response(responseBody(incoming, method), {
            status: incoming.statusCode,
            statusText: incoming.statusMessage,
            headers: responseHeaders,
          }),
          connectedAddress: normalizePeerAddress(connectedAddress),
        });
      },
    );
    request.once('error', reject);
    request.end();
  });
}

/** Node-only transport that connects to a reviewed DNS answer while preserving Host and TLS SNI. */
export const nodeWebPageConnector: WebPageConnector = async (
  url,
  init,
  approvedAddresses,
) => {
  let lastError: unknown;
  for (const address of approvedAddresses) {
    try {
      return await connectToAddress(url, init, address);
    } catch (error) {
      if (init.signal?.aborted) throw error;
      lastError = error;
    }
  }
  throw lastError ?? new Error('web_page_connection_failed');
};
