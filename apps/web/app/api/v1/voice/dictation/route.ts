import { randomUUID } from 'node:crypto';
import { readAuthenticatedRequestIdentity } from '@/server/auth/request-identity';
import { readExperienceMode } from '@/server/experience-mode';
import {
  isTrustedSameOriginWrite,
  jsonError,
  jsonResponse,
} from '@/server/http/request-security';
import { resolveDictationGateway } from '@/server/voice/dictation-gateway';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const DICTATION_MAX_BYTES = 2 * 1024 * 1024;
const WAV_HEADER_BYTES = 44;
const PCM_BYTES_PER_SECOND = 16_000 * 2;
const WEBM_MAGIC = Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3]);

async function readLimitedBody(request: Request): Promise<Uint8Array | null> {
  const declared = request.headers.get('content-length');
  if (
    declared &&
    (!/^\d+$/.test(declared) || Number(declared) > DICTATION_MAX_BYTES)
  ) {
    return null;
  }
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > DICTATION_MAX_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return new Uint8Array();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function isSupportedPcmWav(bytes: Uint8Array): boolean {
  if (bytes.byteLength <= WAV_HEADER_BYTES) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (offset: number, length: number) =>
    String.fromCharCode(...bytes.subarray(offset, offset + length));
  if (ascii(0, 4) !== 'RIFF' || ascii(8, 4) !== 'WAVE') return false;
  if (ascii(12, 4) !== 'fmt ' || view.getUint16(20, true) !== 1) return false;
  if (view.getUint16(22, true) !== 1 || view.getUint32(24, true) !== 16_000) {
    return false;
  }
  if (view.getUint16(34, true) !== 16 || ascii(36, 4) !== 'data') return false;
  const dataBytes = view.getUint32(40, true);
  return (
    dataBytes > 0 &&
    dataBytes === bytes.byteLength - WAV_HEADER_BYTES &&
    dataBytes <= 60 * PCM_BYTES_PER_SECOND
  );
}

function isSupportedWebm(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength > WEBM_MAGIC.byteLength &&
    WEBM_MAGIC.every((value, index) => bytes[index] === value)
  );
}

export async function POST(request: Request): Promise<Response> {
  if (!isTrustedSameOriginWrite(request)) {
    return jsonError(403, 'forbidden_origin');
  }
  const identity = await readAuthenticatedRequestIdentity(request);
  if (!identity) {
    return jsonError(401, 'unauthorized');
  }
  if (identity.source === 'web' && (await readExperienceMode()) === null) {
    return jsonError(409, 'experience_mode_required');
  }
  const contentType =
    request.headers
      .get('content-type')
      ?.split(';', 1)[0]
      ?.trim()
      .toLowerCase() ?? '';
  if (contentType !== 'audio/wav' && contentType !== 'audio/webm')
    return jsonError(415, 'unsupported_media_type');
  const bytes = await readLimitedBody(request);
  if (bytes === null) {
    return jsonError(413, 'audio_too_large');
  }
  const validAudio =
    contentType === 'audio/wav'
      ? isSupportedPcmWav(bytes)
      : isSupportedWebm(bytes);
  if (!validAudio) {
    return jsonError(400, 'invalid_audio');
  }
  const gateway = resolveDictationGateway();
  if (!gateway) {
    return jsonError(503, 'dictation_unavailable');
  }
  const operationId = randomUUID();
  try {
    const result = await gateway.transcribeAudio({
      taskAlias: 'audio.transcribe',
      modelAlias: 'transcription',
      audioBytes: bytes,
      mimeType: contentType,
      promptVersion: 'voice.dictation.v1',
      traceId: randomUUID(),
      operationId,
      signal: request.signal,
    });
    return jsonResponse({ text: result.text.trim() });
  } catch {
    return jsonError(503, 'dictation_failed');
  }
}
