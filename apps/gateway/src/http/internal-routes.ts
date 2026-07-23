import {
  HANDLED,
  UNHANDLED,
  readJsonBody,
  writeEvent,
  writeJson,
  type GatewayRouteContext,
  type GatewayRouteResult,
} from './common';

/**
 * /v1/internal/* 路由：内部 token 鉴权已由顶层分派在进入此处前完成，因此这里只做路由。
 * 各端点路径互斥，未命中时返回 unhandled 交回顶层收敛为 404（与拆分前一致）。
 */
export async function handleInternalRoutes(
  ctx: GatewayRouteContext,
): Promise<GatewayRouteResult> {
  const { request, response, url, deps } = ctx;

  if (request.method === 'GET' && url.pathname === '/v1/internal/metrics') {
    writeJson(response, 200, deps.observability?.snapshot() ?? {});
    return HANDLED;
  }

  if (request.method === 'POST' && url.pathname === '/v1/internal/envelopes') {
    const body = await readJsonBody(request);
    response.writeHead(200, {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    });
    for await (const event of deps.service.handle(body)) {
      writeEvent(response, event, deps.observability);
    }
    response.end();
    return HANDLED;
  }

  const nodeInvocationMatch =
    request.method === 'POST'
      ? url.pathname.match(
          /^\/v1\/internal\/nodes\/([A-Za-z0-9._:-]+)\/invocations$/,
        )
      : null;
  if (nodeInvocationMatch) {
    if (!deps.nodeTransport) {
      writeJson(response, 503, {
        error: { code: 'NODE_TRANSPORT_DISABLED' },
      });
      return HANDLED;
    }
    const body = (await readJsonBody(request)) as Record<string, unknown>;
    writeJson(response, 202, {
      invocation: await deps.nodeTransport.nodes.enqueue({
        ...body,
        nodeId: nodeInvocationMatch[1],
      }),
    });
    return HANDLED;
  }

  const match =
    request.method === 'GET'
      ? url.pathname.match(
          /^\/v1\/internal\/operations\/([A-Za-z0-9._:-]+)\/events$/,
        )
      : null;
  if (match) {
    const actorUserId = request.headers['x-educanvas-user-id'];
    if (typeof actorUserId !== 'string' || actorUserId.length > 160) {
      writeJson(response, 400, { error: { code: 'INVALID_REQUEST' } });
      return HANDLED;
    }
    const after = Number(url.searchParams.get('after') ?? '-1');
    if (!Number.isInteger(after) || after < -1) {
      writeJson(response, 400, { error: { code: 'INVALID_REQUEST' } });
      return HANDLED;
    }
    const events = await deps.service.resume({
      operationId: match[1]!,
      afterSequence: after,
      principalUserId: actorUserId,
    });
    writeJson(response, 200, { events });
    return HANDLED;
  }

  return UNHANDLED;
}
