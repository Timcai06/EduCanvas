import 'server-only';

import { jsonError } from './request-security';

export type JsonRequestValidationCode =
  'invalid_content_type' | 'request_too_large' | 'invalid_json';

export class JsonRequestValidationError extends Error {
  override readonly name = 'JsonRequestValidationError';

  constructor(readonly code: JsonRequestValidationCode) {
    super(code);
  }
}

const DEFAULT_MAX_JSON_BODY_BYTES = 64 * 1024;

async function readLimitedUtf8(
  request: Request,
  maxBytes: number,
): Promise<string> {
  const contentLength = request.headers.get('content-length');
  if (contentLength !== null) {
    const parsed = Number(contentLength);
    if (!Number.isSafeInteger(parsed) || parsed < 0) {
      throw new JsonRequestValidationError('invalid_json');
    }
    if (parsed > maxBytes) {
      throw new JsonRequestValidationError('request_too_large');
    }
  }
  if (!request.body) throw new JsonRequestValidationError('invalid_json');

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      byteLength += result.value.byteLength;
      if (byteLength > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new JsonRequestValidationError('request_too_large');
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }

  const joined = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(joined);
  } catch {
    throw new JsonRequestValidationError('invalid_json');
  }
}

/**
 * Shared JSON body reader for cookie-authenticated mutation routes.
 * It rejects oversized bodies before buffering them fully and keeps parse errors
 * mapped to stable public error codes instead of raw SyntaxError details.
 */
export async function readLimitedJsonRequest(
  request: Request,
  options: { maxBytes?: number } = {},
): Promise<unknown> {
  const contentType = request.headers.get('content-type')?.toLowerCase();
  if (contentType?.split(';', 1)[0]?.trim() !== 'application/json') {
    throw new JsonRequestValidationError('invalid_content_type');
  }

  try {
    return JSON.parse(
      await readLimitedUtf8(
        request,
        options.maxBytes ?? DEFAULT_MAX_JSON_BODY_BYTES,
      ),
    ) as unknown;
  } catch (error) {
    if (error instanceof JsonRequestValidationError) throw error;
    throw new JsonRequestValidationError('invalid_json');
  }
}

export function jsonRequestErrorResponse(
  error: JsonRequestValidationError,
): Response {
  if (error.code === 'invalid_content_type') {
    return jsonError(415, error.code, '请求必须使用 JSON 格式。');
  }
  if (error.code === 'request_too_large') {
    return jsonError(413, error.code, '请求内容太大，请精简后再提交。');
  }
  return jsonError(400, 'invalid_request', '请求格式不正确。');
}
