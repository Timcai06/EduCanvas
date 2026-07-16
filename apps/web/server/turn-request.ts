import 'server-only';

import {
  agentMessageInputSchema,
  extractAgentMessageText,
  normalizeAgentMessageParts,
  type AgentMessagePart,
} from '@educanvas/agent-core';

const MAX_TURN_REQUEST_BYTES = 64 * 1024;
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
  parts: readonly AgentMessagePart[];
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

/**
 * Route 只接受 clientMessageId 加 text，或 clientMessageId 加受 Schema
 * 约束的 message parts。浏览器可以引用已经过服务端归属校验的 Asset，
 * 但不能声明可信身份、session、私有存储键或模型选择。
 */
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
    Array.isArray(value)
  ) {
    throw new TurnRequestValidationError('invalid_request');
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.clientMessageId !== 'string' ||
    !CLIENT_MESSAGE_ID.test(record.clientMessageId)
  ) {
    throw new TurnRequestValidationError('invalid_request');
  }

  const keys = Object.keys(record).sort().join(',');
  const candidate =
    keys === 'clientMessageId,text' && typeof record.text === 'string'
      ? {
          clientMessageId: record.clientMessageId,
          parts: [{ type: 'text' as const, text: record.text }],
        }
      : keys === 'clientMessageId,parts'
        ? {
            clientMessageId: record.clientMessageId,
            parts: record.parts,
          }
        : null;
  const parsed = agentMessageInputSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new TurnRequestValidationError('invalid_request');
  }
  const parts = normalizeAgentMessageParts(parsed.data.parts);
  const text = extractAgentMessageText(parts);
  if (text.length > MAX_STUDENT_MESSAGE_CHARACTERS) {
    throw new TurnRequestValidationError('invalid_request');
  }
  return {
    clientMessageId: parsed.data.clientMessageId,
    text,
    parts,
  };
}
