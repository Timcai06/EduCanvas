import { readTeachingRequestScope } from '@/server/teaching/request-scope';
import { loadOwnedTeachingGatewayTarget } from '@/server/teaching/learning-session';
import { TurnRequestValidationError } from '@/server/http/turn-request';
import { ChatLifecycleError, DrizzleChatRepository } from '@educanvas/db';
import { readAnonymousIdentity } from '@/server/identity/anonymous-identity';
import {
  isTrustedSameOriginWrite,
  jsonError,
  jsonResponse,
} from '@/server/http/request-security';
import { abortRegisteredTurn } from '@/server/http/turn-abort-registry';

export const runtime = 'nodejs';

const chat = new DrizzleChatRepository();

export async function POST(
  request: Request,
  context: { params: Promise<{ turnId: string }> },
): Promise<Response> {
  if (!isTrustedSameOriginWrite(request)) {
    return jsonError(403, 'forbidden_origin');
  }
  const identity = await readAnonymousIdentity();
  if (!identity) {
    return jsonError(401, 'unauthorized');
  }

  const { turnId } = await context.params;
  try {
    const scope = readTeachingRequestScope(request);
    if (scope) {
      const target = await loadOwnedTeachingGatewayTarget(
        identity,
        scope.notebookId,
        scope.conversationId,
      );
      const owned = await chat.getOwnedTurnByTurnId({
        trustedStudentId: identity.studentId,
        turnId,
      });
      if (
        !target ||
        !owned ||
        owned.studentMessage.sessionId !== target.sessionId
      )
        return jsonError(404, 'turn_not_found');
    }
    const result = await chat.requestTurnCancellation({
      trustedStudentId: identity.studentId,
      turnId,
    });
    if (!result.turn) {
      return jsonError(404, 'turn_not_found');
    }

    abortRegisteredTurn(turnId);
    return jsonResponse(
      {
        turnId,
        accepted: result.accepted,
        status: result.turn.assistantMessage.status,
      },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (error) {
    if (error instanceof TurnRequestValidationError)
      return jsonError(400, error.code);
    if (error instanceof ChatLifecycleError) {
      return jsonError(400, 'invalid_turn');
    }
    return jsonError(503, 'cancel_unavailable');
  }
}
