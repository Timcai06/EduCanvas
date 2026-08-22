import { gatewayDesktopAuthorizationQuerySchema } from '@educanvas/gateway-core';
import { readRegisteredSessionIdentity } from '@/server/auth/session';
import { readAnonymousIdentity } from '@/server/identity/anonymous-identity';
import { getDesktopAuthService } from '@/server/desktop-auth/server-service';
import { loadOwnedGeneralConversation } from '@/server/platform/general-conversation';
import {
  isTrustedSameOriginWrite,
  jsonError,
} from '@/server/http/request-security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_FORM_BYTES = 4_096;

export async function POST(request: Request): Promise<Response> {
  if (!isTrustedSameOriginWrite(request)) {
    return jsonError(403, 'forbidden_origin');
  }
  const identity = await readRegisteredSessionIdentity();
  if (!identity) return jsonError(401, 'unauthorized');
  const contentType = request.headers.get('content-type')?.split(';', 1)[0];
  const declaredLength = Number(request.headers.get('content-length') ?? '0');
  if (
    contentType !== 'application/x-www-form-urlencoded' ||
    !Number.isSafeInteger(declaredLength) ||
    declaredLength < 0 ||
    declaredLength > MAX_FORM_BYTES
  ) {
    return jsonError(400, 'invalid_request');
  }
  let parsed: ReturnType<
    typeof gatewayDesktopAuthorizationQuerySchema.safeParse
  >;
  try {
    const text = await request.text();
    if (Buffer.byteLength(text, 'utf8') > MAX_FORM_BYTES) {
      return jsonError(400, 'invalid_request');
    }
    parsed = gatewayDesktopAuthorizationQuerySchema.safeParse(
      Object.fromEntries(new URLSearchParams(text)),
    );
  } catch {
    return jsonError(400, 'invalid_request');
  }
  if (!parsed.success) {
    return jsonError(400, 'invalid_request');
  }

  try {
    // The Web Agent runtime is authoritative for identity. In local deployment
    // it intentionally uses EDUCANVAS_LOCAL_USER_ID instead of the account
    // id, while production resolves the registered id here.
    const runtimeIdentity = await readAnonymousIdentity();
    if (!runtimeIdentity) {
      return jsonError(409, 'no_conversation');
    }
    const conversation = await loadOwnedGeneralConversation(runtimeIdentity);
    const grant = await getDesktopAuthService().issueAuthorizationCode({
      userId: runtimeIdentity.studentId,
      codeChallenge: parsed.data.code_challenge,
      ...(conversation
        ? {
            notebookId: conversation.spaceId,
            conversationId: conversation.id,
          }
        : {}),
    });
    const callback = new URL(parsed.data.redirect_uri);
    callback.searchParams.set('code', grant.code);
    callback.searchParams.set('state', parsed.data.state);
    return new Response(null, {
      status: 303,
      headers: {
        location: callback.toString(),
        'cache-control': 'no-store',
        'referrer-policy': 'no-referrer',
      },
    });
  } catch {
    return jsonError(503, 'desktop_auth_unavailable');
  }
}
