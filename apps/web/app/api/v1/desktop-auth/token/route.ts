import { gatewayDesktopTokenExchangeRequestSchema } from '@educanvas/gateway-core';
import { getDesktopAuthService } from '@/server/desktop-auth/server-service';
import {
  JsonRequestValidationError,
  jsonRequestErrorResponse,
  readLimitedJsonRequest,
} from '@/server/http/json-request';
import {
  isTrustedSameOriginWrite,
  jsonError,
  jsonResponse,
} from '@/server/http/request-security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  if (!isTrustedSameOriginWrite(request)) {
    return jsonError(403, 'forbidden_origin', '请求来源不受信任。');
  }
  let raw: unknown;
  try {
    raw = await readLimitedJsonRequest(request, { maxBytes: 2_048 });
  } catch (error) {
    return error instanceof JsonRequestValidationError
      ? jsonRequestErrorResponse(error)
      : jsonError(400, 'invalid_request', '授权交换格式不正确。');
  }
  const parsed = gatewayDesktopTokenExchangeRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return jsonError(400, 'invalid_request', '授权交换格式不正确。');
  }
  try {
    return jsonResponse(await getDesktopAuthService().exchange(parsed.data));
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    return code === 'invalid_grant'
      ? jsonError(400, 'invalid_grant', '授权已失效，请重新登录。')
      : jsonError(503, 'desktop_auth_unavailable', '桌面授权暂不可用。');
  }
}
