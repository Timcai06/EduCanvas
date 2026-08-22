import { GatewayPersistenceError } from '@educanvas/db';
import { gatewayConnectionConnectRequestSchema } from '@educanvas/gateway-core';
import { GatewayConnectionRuntimeError } from '@educanvas/gateway-runtime';
import { createWebConnectionService } from '@/server/gateway/connections';
import {
  isTrustedSameOriginWrite,
  jsonError,
  jsonResponse,
} from '@/server/http/request-security';
import {
  JsonRequestValidationError,
  jsonRequestErrorResponse,
  readLimitedJsonRequest,
} from '@/server/http/json-request';
import { readAnonymousIdentity } from '@/server/identity/anonymous-identity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 发起当前 Web 主体的渠道授权；请求不能声明 userId、外部账号或到期时间。 */
export async function POST(request: Request): Promise<Response> {
  if (!isTrustedSameOriginWrite(request)) {
    return jsonError(403, 'forbidden_origin');
  }
  const identity = await readAnonymousIdentity();
  if (!identity) return jsonError(401, 'unauthorized');
  let raw: unknown;
  try {
    raw = await readLimitedJsonRequest(request);
  } catch (error) {
    if (error instanceof JsonRequestValidationError) {
      return jsonRequestErrorResponse(error);
    }
    throw error;
  }
  const parsed = gatewayConnectionConnectRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return jsonError(400, 'invalid_request');
  }
  try {
    return jsonResponse(
      await createWebConnectionService().connect({
        userId: identity.studentId,
        request: parsed.data,
      }),
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof GatewayConnectionRuntimeError) {
      return jsonError(409, 'provider_disabled');
    }
    if (error instanceof GatewayPersistenceError) {
      if (error.code === 'idempotency_conflict') {
        return jsonError(409, 'connection_exists');
      }
      return jsonError(403, 'forbidden');
    }
    return jsonError(503, 'connection_failed');
  }
}
