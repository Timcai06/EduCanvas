import { GatewayPersistenceError } from '@educanvas/db';
import { gatewayConnectionRevokeRequestSchema } from '@educanvas/gateway-core';
import { createWebConnectionService } from '@/server/gateway/connections';
import {
  isTrustedSameOriginWrite,
  jsonError,
} from '@/server/http/request-security';
import { readAnonymousIdentity } from '@/server/identity/anonymous-identity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 撤销当前 Web 主体自己的连接；数据库保留 revokedAt，且跨主体请求不生效。 */
export async function POST(request: Request): Promise<Response> {
  if (!isTrustedSameOriginWrite(request)) {
    return jsonError(403, 'forbidden_origin', '请求来源不受信任。');
  }
  const identity = await readAnonymousIdentity();
  if (!identity) return jsonError(401, 'unauthorized', '请先开始对话。');
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonError(400, 'invalid_request', '请求格式不正确。');
  }
  const parsed = gatewayConnectionRevokeRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return jsonError(400, 'invalid_request', '撤销参数不正确。');
  }
  try {
    return Response.json(
      await createWebConnectionService().revoke({
        userId: identity.studentId,
        connectionId: parsed.data.connectionId,
      }),
    );
  } catch (error) {
    if (error instanceof GatewayPersistenceError) {
      return jsonError(403, 'forbidden', '这个连接不存在或不属于你。');
    }
    return jsonError(503, 'revoke_failed', '暂时无法撤销连接。');
  }
}
