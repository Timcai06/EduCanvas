import { randomUUID } from 'node:crypto';
import { z } from 'zod';
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
import { resolveSpeechGateway } from '@/server/voice/speech-gateway';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const requestSchema = z
  .object({ text: z.string().trim().min(1).max(3_500) })
  .strict();

export async function POST(request: Request): Promise<Response> {
  if (!isTrustedSameOriginWrite(request))
    return jsonError(403, 'forbidden_origin', '请求来源不受信任。');

  const identity = await readAnonymousIdentity();
  if (!identity || identity.studentId.startsWith('anon:v1:'))
    return jsonError(401, 'unauthorized', '请先登录后使用语音。');
  if ((await readExperienceMode()) === null)
    return jsonError(409, 'experience_mode_required', '请先选择使用模式。');

  let raw: unknown;
  try {
    raw = await readLimitedJsonRequest(request, { maxBytes: 16_000 });
  } catch (error) {
    return error instanceof JsonRequestValidationError
      ? jsonRequestErrorResponse(error)
      : jsonError(400, 'invalid_request', '语音请求格式不正确。');
  }
  const parsed = requestSchema.safeParse(raw);
  if (!parsed.success)
    return jsonError(400, 'invalid_request', '语音请求格式不正确。');

  const gateway = resolveSpeechGateway();
  if (!gateway)
    return jsonError(503, 'speech_unavailable', '语音回答暂不可用。');

  try {
    const result = await gateway.generateSpeech({
      taskAlias: 'speech.generate',
      modelAlias: 'speech',
      input: parsed.data.text,
      format: 'mp3',
      promptVersion: 'desktop.voice.reply.v1',
      traceId: randomUUID(),
      operationId: randomUUID(),
      signal: request.signal,
    });
    return new Response(result.bytes.slice().buffer, {
      headers: {
        'content-type': 'audio/mpeg',
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
      },
    });
  } catch {
    return jsonError(503, 'speech_failed', '语音回答暂时失败。');
  }
}
