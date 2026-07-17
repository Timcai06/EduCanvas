import {
  AssetAccessError,
  ChatMessageIdConflictError,
  LearningSessionOwnershipError,
  MessagePartValidationError,
  TurnInProgressError,
  TurnRateLimitError,
} from '@educanvas/db';
import { ModelGatewayConfigurationError } from '@educanvas/model-gateway';
import type { TeachingTurnEvent } from '@/features/chat/turn-events';
import { readAnonymousIdentity } from '@/server/identity/anonymous-identity';
import { UnsupportedAssetModalityError } from '@/server/assets/asset-materialization';
import { beginOwnedTeachingTurn } from '@/server/teaching/learning-turn';
import { isTrustedSameOriginWrite, jsonError } from '@/server/http/request-security';
import { createSseEventStream, sseResponse } from '@/server/http/sse';
import {
  parseTeachingTurnRequest,
  TurnRequestValidationError,
} from '@/server/http/turn-request';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 断开浏览器连接只停止写入响应，不把网络断开误当成学生点击“停止”。
 * 后台生成仍会完成持久化；显式停止必须调用 turn/:id/cancel。
 */
export function createTeachingTurnEventStream(
  events: AsyncIterable<TeachingTurnEvent>,
): ReadableStream<Uint8Array> {
  return createSseEventStream(events);
}

function validationErrorResponse(error: TurnRequestValidationError): Response {
  if (error.code === 'invalid_content_type') {
    return jsonError(415, error.code, '请求必须使用 JSON 格式。');
  }
  if (error.code === 'request_too_large') {
    return jsonError(413, error.code, '这条消息太长，请精简后再发送。');
  }
  return jsonError(400, error.code, '消息格式不正确。');
}

export async function POST(request: Request): Promise<Response> {
  if (!isTrustedSameOriginWrite(request)) {
    return jsonError(403, 'forbidden_origin', '请求来源不受信任。');
  }

  const identity = await readAnonymousIdentity();
  if (!identity) {
    return jsonError(401, 'unauthorized', '请先开始学习。');
  }

  try {
    const body = await parseTeachingTurnRequest(request);
    const turn = await beginOwnedTeachingTurn(identity, body);
    return sseResponse(createTeachingTurnEventStream(turn.events));
  } catch (error) {
    if (error instanceof TurnRequestValidationError) {
      return validationErrorResponse(error);
    }
    if (error instanceof ChatMessageIdConflictError) {
      return jsonError(409, error.code, '这条消息标识已被其他内容使用。');
    }
    if (error instanceof TurnInProgressError) {
      return jsonError(409, error.code, 'AI 老师仍在回答上一条消息。');
    }
    if (error instanceof TurnRateLimitError) {
      return jsonError(429, error.code, '提问太频繁，请稍后再试。', {
        retryAfterMs: error.retryAfterMs,
      });
    }
    if (error instanceof LearningSessionOwnershipError) {
      return jsonError(404, error.code, '当前学习会话不存在。');
    }
    if (
      error instanceof AssetAccessError ||
      error instanceof MessagePartValidationError
    ) {
      return jsonError(
        422,
        'asset_not_available',
        '附件不存在、未就绪或不属于当前对话。',
      );
    }
    if (error instanceof UnsupportedAssetModalityError) {
      return jsonError(
        422,
        error.code,
        '文件已保存，但当前模型暂时不能理解图片；PDF文字资料可以直接用于对话。',
      );
    }
    if (error instanceof ModelGatewayConfigurationError) {
      return jsonError(
        503,
        'model_configuration_invalid',
        'AI 老师暂时无法连接，请稍后重试。',
      );
    }
    return jsonError(
      503,
      'turn_unavailable',
      'AI 老师暂时无法回答，请稍后重试。',
    );
  }
}
