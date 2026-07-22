import { gatewayOpaqueIdSchema } from '@educanvas/gateway-core';
import { z } from 'zod';
import { readBearerToken } from '../client-auth';
import {
  HANDLED,
  UNHANDLED,
  isAuthorized,
  readJsonBody,
  writeJson,
  type GatewayRouteContext,
  type GatewayRouteResult,
} from './common';

/**
 * /v1/node/* 路由：配对使用 bootstrap token，其余端点使用 Node session token。
 * 先处理 /v1/node/pair 再进入 session 鉴权组，保证配对不会被 session 校验拦截；
 * 鉴权通过但子路由未命中时返回 unhandled，交回顶层收敛为 404（与拆分前一致）。
 */
export async function handleNodeRoutes(
  ctx: GatewayRouteContext,
): Promise<GatewayRouteResult> {
  const { request, response, url, deps } = ctx;

  if (request.method === 'POST' && url.pathname === '/v1/node/pair') {
    const nodes = deps.nodeTransport ?? null;
    if (!nodes) {
      writeJson(response, 503, {
        error: { code: 'NODE_TRANSPORT_DISABLED' },
      });
      return HANDLED;
    }
    if (!isAuthorized(request, nodes.bootstrapToken)) {
      writeJson(response, 401, { error: { code: 'UNAUTHENTICATED' } });
      return HANDLED;
    }
    const body = z
      .object({ userId: gatewayOpaqueIdSchema, request: z.unknown() })
      .strict()
      .parse(await readJsonBody(request));
    const pairing = await nodes.nodes.pair(body);
    writeJson(response, 200, {
      pairing,
      ...nodes.sessionAuth.issue({
        nodeId: pairing.nodeId,
        userId: pairing.userId,
      }),
    });
    return HANDLED;
  }

  if (url.pathname.startsWith('/v1/node/')) {
    const nodes = deps.nodeTransport ?? null;
    const token = readBearerToken(request.headers.authorization);
    const claims = nodes && token ? nodes.sessionAuth.verify(token) : null;
    if (!nodes) {
      writeJson(response, 503, {
        error: { code: 'NODE_TRANSPORT_DISABLED' },
      });
      return HANDLED;
    }
    if (!claims || !(await nodes.nodes.getActive(claims.nodeId))) {
      writeJson(response, 401, { error: { code: 'UNAUTHENTICATED' } });
      return HANDLED;
    }
    if (request.method === 'POST' && url.pathname === '/v1/node/heartbeat') {
      const body = (await readJsonBody(request)) as { nodeId?: unknown };
      if (body.nodeId !== claims.nodeId) {
        writeJson(response, 403, { error: { code: 'FORBIDDEN' } });
        return HANDLED;
      }
      await nodes.nodes.heartbeat(body);
      writeJson(response, 200, { status: 'ok' });
      return HANDLED;
    }
    if (request.method === 'GET' && url.pathname === '/v1/node/invocations') {
      writeJson(response, 200, {
        invocations: await nodes.nodes.poll(claims.nodeId),
      });
      return HANDLED;
    }
    if (
      request.method === 'POST' &&
      url.pathname === '/v1/node/invocation-results'
    ) {
      const body = (await readJsonBody(request)) as { nodeId?: unknown };
      if (body.nodeId !== claims.nodeId) {
        writeJson(response, 403, { error: { code: 'FORBIDDEN' } });
        return HANDLED;
      }
      writeJson(response, 200, { result: await nodes.nodes.settle(body) });
      return HANDLED;
    }
    return UNHANDLED;
  }

  return UNHANDLED;
}
