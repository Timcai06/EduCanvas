import {
  AssetAccessError,
  ChatMessageIdConflictError,
  LearningSessionOwnershipError,
  MessagePartValidationError,
  TurnInProgressError,
  TurnRateLimitError,
} from '@educanvas/db';
import { ModelGatewayConfigurationError } from '@educanvas/model-gateway';
import { readAnonymousIdentity } from '@/server/identity/anonymous-identity';
import { UnsupportedAssetModalityError } from '@/server/assets/asset-materialization';
import { beginTeachingGatewayTurn } from '@/server/gateway/teaching-turn';
import {
  isTrustedSameOriginWrite,
  jsonError,
} from '@/server/http/request-security';
import { sseResponse } from '@/server/http/sse';
import { createTeachingTurnEventStream } from '@/server/http/teaching-turn-stream';
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

export async function POST(request: Request): Promise<Response> {
  if (!isTrustedSameOriginWrite(request)) {
    return jsonError(403, 'forbidden_origin');
  }

  const identity = await readAnonymousIdentity();
  if (!identity) {
    return jsonError(401, 'unauthorized');
  }

  try {
    const body = await parseTeachingTurnRequest(request);
    const turn = await beginTeachingGatewayTurn(identity, body);
    return sseResponse(createTeachingTurnEventStream(turn.events));
  } catch (error) {
    if (error instanceof TurnRequestValidationError) {
      return validationErrorResponse(error);
    }
    if (error instanceof ChatMessageIdConflictError) {
      return jsonError(409, error.code);
    }
    if (error instanceof TurnInProgressError) {
      return jsonError(409, error.code);
    }
    if (error instanceof TurnRateLimitError) {
      return jsonError(429, error.code, {
        retryAfterMs: error.retryAfterMs,
      });
    }
    if (error instanceof LearningSessionOwnershipError) {
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
    if (error instanceof ModelGatewayConfigurationError) {
      return jsonError(503, 'model_configuration_invalid');
    }
    return jsonError(503, 'turn_unavailable');
  }
}
