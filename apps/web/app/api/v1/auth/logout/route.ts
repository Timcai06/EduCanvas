import {
  isTrustedSameOriginWrite,
  jsonError,
  jsonResponse,
} from '@/server/http/request-security';
import { revokeCurrentWebSession } from '@/server/auth/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  if (!isTrustedSameOriginWrite(request)) {
    return jsonError(403, 'forbidden_origin');
  }
  try {
    await revokeCurrentWebSession();
    return jsonResponse({ ok: true });
  } catch {
    return jsonError(503, 'logout_unavailable');
  }
}
