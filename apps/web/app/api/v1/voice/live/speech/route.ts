import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { resolveDashScopeStreamingSpeechGateway } from '@educanvas/model-gateway';
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

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const requestSchema = z
  .object({ text: z.string().trim().min(1).max(20_000) })
  .strict();

export async function POST(request: Request): Promise<Response> {
  if (!isTrustedSameOriginWrite(request))
    return jsonError(403, 'forbidden_origin');
  const identity = await readAnonymousIdentity();
  if (!identity || identity.studentId.startsWith('anon:v1:'))
    return jsonError(401, 'unauthorized');
  if ((await readExperienceMode()) === null)
    return jsonError(409, 'experience_mode_required');
  let raw: unknown;
  try {
    raw = await readLimitedJsonRequest(request, { maxBytes: 80_000 });
  } catch (error) {
    return error instanceof JsonRequestValidationError
      ? jsonRequestErrorResponse(error)
      : jsonError(400, 'invalid_request');
  }
  const parsed = requestSchema.safeParse(raw);
  if (!parsed.success) return jsonError(400, 'invalid_request');
  const gateway = resolveDashScopeStreamingSpeechGateway(process.env);
  if (!gateway) return jsonError(503, 'live_voice_unavailable');
  const abort = new AbortController();
  request.signal.addEventListener('abort', () => abort.abort(), { once: true });
  const events = gateway.streamSpeech({
    taskAlias: 'speech.generate',
    modelAlias: 'speech',
    input: parsed.data.text,
    operationId: randomUUID(),
    traceId: randomUUID(),
    signal: abort.signal,
  });
  const iterator = events[Symbol.asyncIterator]();
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        while (true) {
          const result = await iterator.next();
          if (result.done) {
            controller.close();
            return;
          }
          if (result.value.type === 'audio') {
            controller.enqueue(result.value.pcmBytes);
            return;
          }
          if (result.value.type === 'failed') {
            throw new Error('speech_failed');
          }
        }
      } catch {
        controller.error(new Error('speech_failed'));
      }
    },
    async cancel() {
      abort.abort();
      await iterator.return?.();
    },
  });
  return new Response(stream, {
    headers: {
      'content-type': 'audio/L16; rate=24000; channels=1',
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}
