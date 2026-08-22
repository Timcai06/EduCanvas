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
    return jsonError(415, error.code, '请求必须使用 JSON 格式。');
  }
  if (error.code === 'request_too_large') {
    return jsonError(413, error.code, '这条消息太长，请精简后再发送。');
  }
  return jsonError(400, error.code, '消息格式不正确。');
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
    return jsonError(403, 'forbidden_origin', '请求来源不受信任。');
  }
  const identity = await readAnonymousIdentity();
  if (!identity) return jsonError(401, 'unauthorized', '请先开始对话。');

  try {
    const body = await parseTeachingTurnRequest(request);
    const turn = await beginWebGatewayTurn(identity, body);
    return sseResponse(createSseEventStream(turn.events));
  } catch (error) {
    if (error instanceof TurnRequestValidationError) {
      return validationErrorResponse(error);
    }
    if (hasStableErrorCode(error, 'deep_research_unavailable')) {
      return jsonError(
        503,
        'deep_research_unavailable',
        '当前部署尚未配置网页搜索，暂时无法开始深度研究。',
      );
    }
    if (error instanceof PlatformMessageIdConflictError) {
      return jsonError(409, error.code, '这条消息标识已被其他内容使用。');
    }
    if (
      error instanceof PlatformTurnInProgressError ||
      hasStableErrorCode(error, 'turn_in_progress')
    ) {
      return jsonError(409, 'turn_in_progress', 'AI 仍在回答上一条消息。');
    }
    if (error instanceof PlatformTurnOwnershipError) {
      return jsonError(404, error.code, '当前对话不存在。');
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
        '文件已保存，但当前模型还不能读懂这种内容；文字资料可以直接用于对话。',
      );
    }
    /* 与上一条分开：这里不是模型能力不足，而是本轮带的图片太多或太大，
       告诉用户「减少几张」是可操作的，说「模型读不懂」会误导。 */
    if (error instanceof NativeAssetBudgetError) {
      return jsonError(
        422,
        error.code,
        error.reason === 'count'
          ? '一次最多带 12 张图片，请先取消勾选一些再发送。'
          : '本轮图片总大小不能超过24MB，请先取消勾选一些再发送。',
      );
    }
    return jsonError(503, 'turn_unavailable', 'AI 暂时无法回答，请稍后重试。');
  }
}
