import { gatewayDesktopSessionTokenSchema } from '@educanvas/gateway-core';
import { GatewayClientError } from './client';

function normalizeBaseUrl(value: string): string {
  const url = new URL(value);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password
  ) {
    throw new Error('Gateway URL must be HTTP(S) without embedded credentials');
  }
  return url.toString().replace(/\/$/, '');
}

/** Revoke an opaque desktop session without putting the credential in URL/body. */
export async function revokeGatewayDesktopSession(
  baseUrl: string,
  token: string,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const sessionToken = gatewayDesktopSessionTokenSchema.parse(token);
  const response = await fetcher(
    `${normalizeBaseUrl(baseUrl)}/v1/client/session/revoke`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${sessionToken}` },
    },
  );
  if (!response.ok) {
    let code = 'GATEWAY_REQUEST_FAILED';
    try {
      const value = (await response.json()) as { error?: { code?: unknown } };
      if (
        typeof value.error?.code === 'string' &&
        value.error.code.length <= 128
      ) {
        code = value.error.code;
      }
    } catch {
      // Response details are intentionally not reflected into the public error.
    }
    throw new GatewayClientError(response.status, code);
  }
  await response.body?.cancel();
}
