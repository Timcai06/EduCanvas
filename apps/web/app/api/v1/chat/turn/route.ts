import {
  AssetAccessError,
  MessagePartValidationError,
  PlatformMessageIdConflictError,
  PlatformTurnInProgressError,
  PlatformTurnOwnershipError,
} from '@educanvas/db';
import { readAnonymousIdentity } from '@/server/identity/anonymous-identity';
import {
  NativeAssetBudgetError,
  UnsupportedAssetModalityError,
} from '@/server/assets/asset-materialization';
import { beginWebGatewayTurn } from '@/server/gateway/web-turn';
import {
  isTrustedSameOriginWrite,
  jsonError,
} from '@/server/http/request-security';
import { createSseEventStream, sseResponse } from '@/server/http/sse';
import {
  parseTeachingTurnRequest,
  TurnRequestValidationError,
} from '@/server/http/turn-request';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function validationErrorResponse(error: TurnRequestValidationError): Response {
  if (error.code === 'invalid_content_type') {
    return jsonError(415, error.code);
  }
  if (error.code === 'request_too_large') {
    return jsonError(413, error.code);
  }
  return jsonError(400, error.code);
}

function hasStableErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === code
  );
}

export async function POST(request: Request): Promise<Response> {
  if (!isTrustedSameOriginWrite(request)) {
    return jsonError(403, 'forbidden_origin');
  }
  const identity = await readAnonymousIdentity();
  if (!identity) return jsonError(401, 'unauthorized');

  try {
    const body = await parseTeachingTurnRequest(request);
    const turn = await beginWebGatewayTurn(identity, body);
    return sseResponse(createSseEventStream(turn.events));
  } catch (error) {
    if (error instanceof TurnRequestValidationError) {
      return validationErrorResponse(error);
    }
    if (hasStableErrorCode(error, 'deep_research_unavailable')) {
      return jsonError(503, 'deep_research_unavailable');
    }
    if (error instanceof PlatformMessageIdConflictError) {
      return jsonError(409, error.code);
    }
    if (
      error instanceof PlatformTurnInProgressError ||
      hasStableErrorCode(error, 'turn_in_progress')
    ) {
      return jsonError(409, 'turn_in_progress');
    }
    if (error instanceof PlatformTurnOwnershipError) {
      return jsonError(404, error.code);
    }
    if (
      error instanceof AssetAccessError ||
      error instanceof MessagePartValidationError
    ) {
      return jsonError(422, 'asset_not_available');
    }
    if (error instanceof UnsupportedAssetModalityError) {
      return jsonError(422, error.code);
    }
    /* 与上一条分开：这里不是模型能力不足，而是本轮带的图片太多或太大，
       告诉用户「减少几张」是可操作的，说「模型读不懂」会误导。 */
    if (error instanceof NativeAssetBudgetError) {
      return jsonError(422, error.code);
    }
    return jsonError(503, 'turn_unavailable');
  }
}
