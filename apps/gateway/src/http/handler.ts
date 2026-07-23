import type { IncomingMessage, ServerResponse } from 'node:http';
import { gatewayRouteLabel } from '../observability';
import { handleClientRoutes, handleLocalOnboard } from './client-routes';
import {
  isAuthorized,
  mapError,
  writeJson,
  type GatewayRouteContext,
} from './common';
import type { GatewayHttpDependencies } from './dependencies';
import { handleInternalRoutes } from './internal-routes';
import { handleNodeRoutes } from './node-routes';

/**
 * Gateway HTTP composition root：健康检查、Internal token 鉴权闸门、按前缀分派到
 * Client/Node/Internal 路由组，以及 404 与顶层异常边界。
 *
 * 四个路由组前缀互斥（/v1/local、/v1/node、/v1/client、/v1/internal），因此顶层顺序等价于
 * 拆分前的顺序检查；每组内部保持原有子路由顺序（如 pair/bootstrap 先于各自的 session 组）。
 * 组内鉴权通过但未命中子路由时返回 unhandled，最终统一收敛为 404，语义与拆分前一致。
 */
export function createGatewayHttpHandler(input: GatewayHttpDependencies) {
  return async (request: IncomingMessage, response: ServerResponse) => {
    const url = new URL(request.url ?? '/', 'http://gateway.internal');
    const finishHttp = input.observability?.beginHttp({
      method: request.method ?? 'UNKNOWN',
      route: gatewayRouteLabel(request.method ?? 'UNKNOWN', url.pathname),
    });
    let httpFinished = false;
    const settleHttp = (status: number) => {
      if (httpFinished) return;
      httpFinished = true;
      finishHttp?.(status);
    };
    response.once('finish', () => settleHttp(response.statusCode));
    response.once('close', () =>
      settleHttp(response.writableEnded ? response.statusCode : 499),
    );
    if (request.method === 'GET' && url.pathname === '/healthz') {
      writeJson(response, 200, {
        service: 'educanvas-gateway',
        status: 'ok',
        protocol: 'gateway.v1',
      });
      return;
    }
    if (url.pathname.startsWith('/v1/internal/')) {
      if (input.internalToken === null) {
        writeJson(response, 503, {
          error: { code: 'INTERNAL_TRANSPORT_DISABLED' },
        });
        return;
      }
      if (!isAuthorized(request, input.internalToken)) {
        writeJson(response, 401, { error: { code: 'UNAUTHENTICATED' } });
        return;
      }
    }

    const ctx: GatewayRouteContext = { request, response, url, deps: input };
    try {
      if ((await handleLocalOnboard(ctx)).handled) return;
      if ((await handleNodeRoutes(ctx)).handled) return;
      if ((await handleClientRoutes(ctx)).handled) return;
      if ((await handleInternalRoutes(ctx)).handled) return;
      writeJson(response, 404, { error: { code: 'NOT_FOUND' } });
    } catch (error) {
      const mapped = mapError(error);
      if (!response.headersSent) {
        writeJson(response, mapped.status, { error: { code: mapped.code } });
      } else {
        response.destroy();
      }
    }
  };
}
