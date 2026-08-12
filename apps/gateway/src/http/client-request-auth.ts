import { createHash } from 'node:crypto';
import { gatewayDesktopSessionTokenSchema } from '@educanvas/gateway-core';
import { writeJson, type GatewayRouteContext } from './common';
import type { GatewayClientTransport } from './dependencies';

function hashDesktopToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Resolve either the existing signed session or a revocable desktop session. */
export async function resolveClientAuth(
  client: GatewayClientTransport,
  token: string | null,
) {
  const signedClaims = token ? client.sessionAuth.verify(token) : null;
  const parsedDesktop = token
    ? gatewayDesktopSessionTokenSchema.safeParse(token)
    : null;
  const desktopUserId =
    !signedClaims && parsedDesktop?.success && client.desktopSessions
      ? await client.desktopSessions.findActiveRegisteredUserIdByTokenHash({
          tokenHash: hashDesktopToken(parsedDesktop.data),
        })
      : null;
  const userId = signedClaims?.userId ?? desktopUserId;
  if (!userId) return null;
  const identity = await client.identities.getActive(userId);
  if (!identity) return null;
  return {
    identity,
    desktopToken: parsedDesktop?.success ? parsedDesktop.data : null,
  };
}

export async function handleDesktopRevoke(
  ctx: GatewayRouteContext,
  client: GatewayClientTransport,
  desktopToken: string | null,
): Promise<boolean> {
  const { request, response, url } = ctx;
  if (
    request.method !== 'POST' ||
    url.pathname !== '/v1/client/session/revoke'
  ) {
    return false;
  }
  if (!desktopToken || !client.desktopSessions) {
    writeJson(response, 400, { error: { code: 'INVALID_REQUEST' } });
    return true;
  }
  await client.desktopSessions.revokeByTokenHash({
    tokenHash: hashDesktopToken(desktopToken),
  });
  response.writeHead(204, { 'cache-control': 'no-store' });
  response.end();
  return true;
}
