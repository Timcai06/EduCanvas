import { GatewayPersistenceError } from '@educanvas/db';
import { gatewayConnectionConnectRequestSchema } from '@educanvas/gateway-core';
import { GatewayConnectionRuntimeError } from '@educanvas/gateway-runtime';
import { createWebConnectionService } from '@/server/gateway/connections';
import {
  isTrustedSameOriginWrite,
  jsonError,
} from '@/server/http/request-security';
import { readAnonymousIdentity } from '@/server/identity/anonymous-identity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 发起当前 Web 主体的渠道授权；请求不能声明 userId、外部账号或到期时间。 */
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
  const parsed = gatewayConnectionConnectRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return jsonError(400, 'invalid_request', '连接参数不正确。');
  }
  try {
    return Response.json(
      await createWebConnectionService().connect({
        userId: identity.studentId,
        request: parsed.data,
      }),
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof GatewayConnectionRuntimeError) {
      return jsonError(409, 'provider_disabled', '这个渠道目前还不能连接。');
    }
    if (error instanceof GatewayPersistenceError) {
      if (error.code === 'idempotency_conflict') {
        return jsonError(
          409,
          'connection_exists',
          '这个渠道已有待确认或有效连接。',
        );
      }
      return jsonError(403, 'forbidden', '无法把渠道连接到这个笔记本。');
    }
    return jsonError(503, 'connection_failed', '暂时无法发起连接。');
  }
}
