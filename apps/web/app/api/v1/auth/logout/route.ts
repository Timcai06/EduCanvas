import {
  isTrustedSameOriginWrite,
  jsonError,
} from '@/server/http/request-security';
import { revokeCurrentWebSession } from '@/server/auth/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  if (!isTrustedSameOriginWrite(request)) {
    return jsonError(403, 'forbidden_origin', '请求来源不受信任。');
  }
  try {
    await revokeCurrentWebSession();
    return Response.json({ ok: true });
  } catch {
    return jsonError(
      503,
      'logout_unavailable',
      '暂时无法安全退出，请稍后重试。',
    );
  }
}
