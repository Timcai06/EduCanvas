import { gatewayOpaqueIdSchema } from '@educanvas/gateway-core';
import { z } from 'zod';
import { evaluateTranscriptionCapability } from '@/features/voice/voice-capability';
import { readAnonymousIdentity } from '@/server/identity/anonymous-identity';
import { readExperienceMode } from '@/server/experience-mode';
import {
  isTrustedSameOriginWrite,
  jsonError,
} from '@/server/http/request-security';
import {
  JsonRequestValidationError,
  jsonRequestErrorResponse,
  readLimitedJsonRequest,
} from '@/server/http/json-request';
import { resolveVoiceCapability } from '@/server/voice/voice-capability';
import {
  issueVoiceStreamingTicket,
  VoiceGatewayError,
} from '@/server/voice/voice-gateway-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const requestSchema = z.object({ notebookId: gatewayOpaqueIdSchema }).strict();

export async function POST(request: Request): Promise<Response> {
  if (!isTrustedSameOriginWrite(request)) {
    return jsonError(403, 'forbidden_origin', '请求来源不受信任。');
  }
  const identity = await readAnonymousIdentity();
  if (!identity || identity.studentId.startsWith('anon:v1:')) {
    return jsonError(401, 'unauthorized', '请先登录后使用语音。');
  }
  const mode = await readExperienceMode();
  if (mode === null) {
    return jsonError(409, 'experience_mode_required', '请先选择使用模式。');
  }
  let raw: unknown;
  try {
    raw = await readLimitedJsonRequest(request, { maxBytes: 1_024 });
  } catch (error) {
    return error instanceof JsonRequestValidationError
      ? jsonRequestErrorResponse(error)
      : jsonError(400, 'invalid_request', '语音请求格式不正确。');
  }
  const parsed = requestSchema.safeParse(raw);
  if (!parsed.success) {
    return jsonError(400, 'invalid_request', '语音请求格式不正确。');
  }
  const capability = await resolveVoiceCapability();
  if (!evaluateTranscriptionCapability(capability.checks).enabled) {
    return jsonError(503, 'voice_capability_unavailable', '语音能力暂不可用。');
  }
  try {
    const ticket = await issueVoiceStreamingTicket({
      subjectUserId: identity.studentId,
      notebookId: parsed.data.notebookId,
    });
    return Response.json(ticket, {
      status: 201,
      headers: { 'cache-control': 'no-store' },
    });
  } catch (error) {
    if (
      error instanceof VoiceGatewayError &&
      error.code === 'VOICE_GATEWAY_RESOURCE_NOT_FOUND'
    ) {
      return jsonError(404, 'not_found', '语音资源不存在或不可访问。');
    }
    const code =
      error instanceof VoiceGatewayError
        ? error.code
        : 'VOICE_GATEWAY_UNAVAILABLE';
    return jsonError(503, code.toLowerCase(), '语音连接暂不可用。');
  }
}
