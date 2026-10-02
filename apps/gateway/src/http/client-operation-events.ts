import { gatewayOperationEventExtensionsSchema } from '@educanvas/gateway-core';
import {
  HANDLED,
  UNHANDLED,
  writeJson,
  type GatewayRouteContext,
  type GatewayRouteResult,
} from './common';

/** Resume a desktop operation's durable event history. */
export async function handleClientOperationEvents(
  ctx: GatewayRouteContext,
  principalUserId: string,
): Promise<GatewayRouteResult> {
  const { request, response, url, deps } = ctx;
  const match =
    request.method === 'GET'
      ? url.pathname.match(
          /^\/v1\/client\/operations\/([A-Za-z0-9._:-]+)\/events$/,
        )
      : null;
  if (!match) return UNHANDLED;

  const after = Number(url.searchParams.get('after') ?? '-1');
  if (!Number.isInteger(after) || after < -1) {
    writeJson(response, 400, { error: { code: 'INVALID_REQUEST' } });
    return HANDLED;
  }
  const eventExtensions = gatewayOperationEventExtensionsSchema.parse(
    url.searchParams.getAll('extension'),
  );
  writeJson(response, 200, {
    events: await deps.service.resume({
      operationId: match[1]!,
      afterSequence: after,
      principalUserId,
      eventExtensions,
    }),
  });
  return HANDLED;
}
