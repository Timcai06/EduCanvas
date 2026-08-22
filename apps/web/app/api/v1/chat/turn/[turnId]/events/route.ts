import { isGatewayTerminalEvent } from '@educanvas/gateway-core';
import { ResearchCheckpointOwnershipError } from '@educanvas/db';
import { readAnonymousIdentity } from '@/server/identity/anonymous-identity';
import { resumeWebGatewayTurn } from '@/server/gateway/web-turn';
import { gatewayToLegacy } from '@/server/gateway/turn-application-projection';
import {
  jsonError,
  jsonResponse,
  isTrustedSameOriginWrite,
} from '@/server/http/request-security';
import { loadOwnedGeneralConversation } from '@/server/platform/general-conversation';
import { webResearchCheckpoints } from '@/server/platform/general-turn-persistence';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_AFTER_SEQUENCE = 1_000_000;
const TURN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;

function hasStableErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === code
  );
}

function parseAfter(request: Request): number | null {
  const values = new URL(request.url).searchParams.getAll('after');
  if (values.length > 1) return null;
  const value = values[0] ?? '-1';
  if (!/^(?:-1|0|[1-9][0-9]*)$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed <= MAX_AFTER_SEQUENCE
    ? parsed
    : null;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ turnId: string }> },
): Promise<Response> {
  if (!isTrustedSameOriginWrite(request)) {
    return jsonError(403, 'forbidden_origin', '请求来源不受信任。');
  }

  const identity = await readAnonymousIdentity();
  if (!identity) return jsonError(401, 'unauthorized', '请先开始对话。');

  const { turnId } = await context.params;
  const afterSequence = parseAfter(request);
  if (!TURN_ID_PATTERN.test(turnId) || afterSequence === null) {
    return jsonError(400, 'invalid_request', '回答标识或恢复位置不正确。');
  }

  try {
    const gatewayEvents = await resumeWebGatewayTurn(identity, {
      turnId,
      afterSequence,
    });
    const conversation = await loadOwnedGeneralConversation(identity);
    const research = conversation
      ? await webResearchCheckpoints.getPublicSnapshot({
          operationId: turnId,
          conversationId: conversation.id,
          actorId: identity.studentId,
        })
      : null;
    const events = [];
    async function* eventStream() {
      yield* gatewayEvents;
    }
    for await (const event of gatewayToLegacy(eventStream())) {
      events.push(event);
    }
    return jsonResponse({
      turnId,
      events,
      nextSequence: gatewayEvents.at(-1)?.sequence ?? afterSequence,
      terminal:
        research?.terminal || gatewayEvents.some(isGatewayTerminalEvent),
      ...(research ? { research } : {}),
    });
  } catch (error) {
    if (error instanceof ResearchCheckpointOwnershipError) {
      return jsonError(404, 'turn_not_found', '回答不存在或不可访问。');
    }
    if (hasStableErrorCode(error, 'operation_not_found')) {
      return jsonError(404, 'turn_not_found', '回答不存在或不可访问。');
    }
    return jsonError(
      503,
      'events_unavailable',
      '暂时无法恢复回答，请稍后重试。',
    );
  }
}
