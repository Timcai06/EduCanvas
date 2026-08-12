import {
  createHash,
  randomBytes as secureRandomBytes,
  timingSafeEqual,
} from 'node:crypto';
import {
  gatewayDesktopAuthorizationQuerySchema,
  gatewayDesktopCallbackSchema,
  gatewayDesktopClientId,
  gatewayDesktopProtocol,
  gatewayDesktopRedirectUri,
} from '@educanvas/gateway-core';

export interface DesktopPkceRequest {
  readonly state: string;
  readonly codeVerifier: string;
  readonly codeChallenge: string;
}

export function createDesktopPkceRequest(
  randomBytes: (size: number) => Buffer = secureRandomBytes,
): DesktopPkceRequest {
  const state = randomBytes(32).toString('base64url');
  const codeVerifier = randomBytes(32).toString('base64url');
  return {
    state,
    codeVerifier,
    codeChallenge: createHash('sha256')
      .update(codeVerifier, 'utf8')
      .digest('base64url'),
  };
}

function isSecureWebBase(url: URL): boolean {
  if (url.protocol === 'https:') return true;
  return (
    url.protocol === 'http:' &&
    ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
  );
}

/** RFC 8252 requires an external user-agent; caller opens this URL with shell.openExternal. */
export function buildDesktopAuthorizationUrl(
  webBaseUrl: string,
  request: DesktopPkceRequest,
): URL {
  const base = new URL(webBaseUrl);
  if (
    !isSecureWebBase(base) ||
    base.username ||
    base.password ||
    base.search ||
    base.hash
  ) {
    throw new Error('desktop_web_url_insecure');
  }
  const query = gatewayDesktopAuthorizationQuerySchema.parse({
    response_type: 'code',
    client_id: gatewayDesktopClientId,
    redirect_uri: gatewayDesktopRedirectUri,
    state: request.state,
    code_challenge: request.codeChallenge,
    code_challenge_method: 'S256',
  });
  const url = new URL('/desktop/authorize', base);
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value);
  }
  return url;
}

export function parseDesktopAuthCallback(
  raw: string,
  expectedState: string,
): { code: string } {
  const url = new URL(raw);
  const keys = [...url.searchParams.keys()];
  if (
    url.protocol !== `${gatewayDesktopProtocol}:` ||
    url.host !== 'auth' ||
    url.pathname !== '/callback' ||
    url.username ||
    url.password ||
    url.hash ||
    keys.length !== 2 ||
    new Set(keys).size !== 2
  ) {
    throw new Error('desktop_auth_callback_invalid');
  }
  const parsed = gatewayDesktopCallbackSchema.parse(
    Object.fromEntries(url.searchParams),
  );
  const supplied = Buffer.from(parsed.state, 'ascii');
  const expected = Buffer.from(expectedState, 'ascii');
  if (
    supplied.byteLength !== expected.byteLength ||
    !timingSafeEqual(supplied, expected)
  ) {
    throw new Error('desktop_auth_state_mismatch');
  }
  return { code: parsed.code };
}

export function findDesktopDeepLink(argv: readonly string[]): string | null {
  return (
    argv.find((value) => value.startsWith(`${gatewayDesktopProtocol}://`)) ??
    null
  );
}
