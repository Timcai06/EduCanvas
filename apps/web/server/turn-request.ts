import 'server-only';

const MAX_TURN_REQUEST_BYTES = 16_384;
const MAX_STUDENT_MESSAGE_CHARACTERS = 4_000;
const CLIENT_MESSAGE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export type TurnRequestValidationCode =
  | 'invalid_content_type'
  | 'request_too_large'
  | 'invalid_json'
  | 'invalid_request';

export class TurnRequestValidationError extends Error {
  override readonly name = 'TurnRequestValidationError';

  constructor(readonly code: TurnRequestValidationCode) {
    super(code);
  }
}

export interface TeachingTurnRequestBody {
  clientMessageId: string;
  text: string;
}

async function readLimitedUtf8(request: Request): Promise<string> {
  const contentLength = request.headers.get('content-length');
  if (contentLength !== null) {
    const parsed = Number(contentLength);
    if (!Number.isSafeInteger(parsed) || parsed < 0) {
      throw new TurnRequestValidationError('invalid_request');
    }
    if (parsed > MAX_TURN_REQUEST_BYTES) {
      throw new TurnRequestValidationError('request_too_large');
    }
  }
  if (!request.body) throw new TurnRequestValidationError('invalid_json');

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      byteLength += result.value.byteLength;
      if (byteLength > MAX_TURN_REQUEST_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new TurnRequestValidationError('request_too_large');
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
    throw new TurnRequestValidationError('invalid_json');
  }
}

/** Route 只接受 clientMessageId + text；身份、session、附件和模型选择均不能由浏览器声明。 */
export async function parseTeachingTurnRequest(
  request: Request,
): Promise<TeachingTurnRequestBody> {
  const contentType = request.headers.get('content-type')?.toLowerCase();
  if (contentType?.split(';', 1)[0]?.trim() !== 'application/json') {
    throw new TurnRequestValidationError('invalid_content_type');
  }

  let value: unknown;
  try {
    value = JSON.parse(await readLimitedUtf8(request)) as unknown;
  } catch (error) {
    if (error instanceof TurnRequestValidationError) throw error;
    throw new TurnRequestValidationError('invalid_json');
  }
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(',') !== 'clientMessageId,text'
  ) {
    throw new TurnRequestValidationError('invalid_request');
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.clientMessageId !== 'string' ||
    !CLIENT_MESSAGE_ID.test(record.clientMessageId) ||
    typeof record.text !== 'string' ||
    record.text.trim().length === 0 ||
    record.text.normalize('NFC').replace(/\r\n?/g, '\n').trim().length >
      MAX_STUDENT_MESSAGE_CHARACTERS
  ) {
    throw new TurnRequestValidationError('invalid_request');
  }
  return {
    clientMessageId: record.clientMessageId,
    text: record.text,
  };
}
