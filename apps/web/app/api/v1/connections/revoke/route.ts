import { GatewayPersistenceError } from '@educanvas/db';
import { gatewayConnectionRevokeRequestSchema } from '@educanvas/gateway-core';
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

/** 撤销当前 Web 主体自己的连接；数据库保留 revokedAt，且跨主体请求不生效。 */
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
  const parsed = gatewayConnectionRevokeRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return jsonError(400, 'invalid_request');
  }
  try {
    return jsonResponse(
      await createWebConnectionService().revoke({
        userId: identity.studentId,
        connectionId: parsed.data.connectionId,
      }),
    );
  } catch (error) {
    if (error instanceof GatewayPersistenceError) {
      return jsonError(403, 'forbidden');
    }
    return jsonError(503, 'revoke_failed');
  }
}
