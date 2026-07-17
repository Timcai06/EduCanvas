import {
  DrizzlePlatformTurnRepository,
  PlatformTurnLifecycleError,
} from '@educanvas/db';
import { readAnonymousIdentity } from '@/server/identity/anonymous-identity';
import { isTrustedSameOriginWrite, jsonError } from '@/server/http/request-security';
import { abortRegisteredTurn } from '@/server/http/turn-abort-registry';

export const runtime = 'nodejs';

const turns = new DrizzlePlatformTurnRepository();

export async function POST(
  request: Request,
  context: { params: Promise<{ turnId: string }> },
): Promise<Response> {
  if (!isTrustedSameOriginWrite(request)) {
    return jsonError(403, 'forbidden_origin', '请求来源不受信任。');
  }
  const identity = await readAnonymousIdentity();
  if (!identity) return jsonError(401, 'unauthorized', '请先开始对话。');

  const { turnId } = await context.params;
  try {
    const result = await turns.requestTurnCancellation({
      trustedSubjectId: identity.studentId,
      turnId,
    });
    if (!result.turn) {
      return jsonError(404, 'turn_not_found', '回答不存在或不可访问。');
    }
    abortRegisteredTurn(turnId);
    return Response.json(
      {
        turnId,
        accepted: result.accepted,
        status: result.turn.assistantMessage.status,
      },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (error) {
    if (error instanceof PlatformTurnLifecycleError) {
      return jsonError(400, 'invalid_turn', '回答标识无效。');
    }
    return jsonError(
      503,
      'cancel_unavailable',
      '暂时无法停止回答，请稍后重试。',
    );
  }
}
