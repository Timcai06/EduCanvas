const TURN_EVENT_SCHEMA_VERSION = '1' as const;
const MAX_ID_LENGTH = 256;
const MAX_CODE_LENGTH = 128;
const MAX_LABEL_LENGTH = 160;
const MAX_MESSAGE_LENGTH = 1_000;
const MAX_DELTA_LENGTH = 32_768;
const MAX_FRAME_LENGTH = 65_536;
const MAX_BUFFER_LENGTH = 131_072;
const MAX_RESPONSE_TEXT_LENGTH = 1_000_000;
const MAX_EVENT_COUNT = 4_096;

interface TurnEventBase {
  schemaVersion: typeof TURN_EVENT_SCHEMA_VERSION;
  turnId: string;
}

export interface TurnAcceptedEvent extends TurnEventBase {
  type: 'turn.accepted';
  studentMessageId: string;
  assistantMessageId: string;
  replayed: boolean;
}

export interface MessageDeltaEvent extends TurnEventBase {
  type: 'message.delta';
  messageId: string;
  delta: string;
}

export interface MessageCitationEvent extends TurnEventBase {
  type: 'message.citation';
  messageId: string;
  citationId: string;
  sourceId: string;
  documentId: string;
  chunkId: string;
  label: string;
  pageStart: number | null;
  pageEnd: number | null;
}

export interface TurnCompletedEvent extends TurnEventBase {
  type: 'turn.completed';
  messageId: string;
}

export interface TurnFailedEvent extends TurnEventBase {
  type: 'turn.failed';
  messageId: string;
  code: string;
  message: string;
  retryable: boolean;
}

export interface TurnCancelledEvent extends TurnEventBase {
  type: 'turn.cancelled';
  messageId: string;
}

export interface ToolLifecycleEvent extends TurnEventBase {
  type: 'tool.started' | 'tool.completed' | 'tool.failed';
  toolCallId: string;
  label?: string;
  code?: string;
}

export type TeachingTurnEvent =
  | TurnAcceptedEvent
  | MessageDeltaEvent
  | MessageCitationEvent
  | TurnCompletedEvent
  | TurnFailedEvent
  | TurnCancelledEvent
  | ToolLifecycleEvent;

export class TurnStreamProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TurnStreamProtocolError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(
  data: Record<string, unknown>,
  key: string,
  eventName: string,
  maxLength = MAX_ID_LENGTH,
): string {
  const value = data[key];
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > maxLength
  ) {
    throw new TurnStreamProtocolError(`${eventName}.${key} is invalid`);
  }
  return value;
}

function readBoolean(
  data: Record<string, unknown>,
  key: string,
  eventName: string,
): boolean {
  const value = data[key];
  if (typeof value !== 'boolean') {
    throw new TurnStreamProtocolError(`${eventName}.${key} is invalid`);
  }
  return value;
}

function readNullablePositiveInteger(
  data: Record<string, unknown>,
  key: string,
  eventName: string,
): number | null {
  const value = data[key];
  if (value === null) return null;
  if (!Number.isInteger(value) || (value as number) < 1) {
    throw new TurnStreamProtocolError(`${eventName}.${key} is invalid`);
  }
  return value as number;
}

/**
 * Parses one named SSE event. Unknown event names are ignored so later
 * additive protocol events do not break an older browser; known events remain
 * strict and versioned.
 */
export function parseTeachingTurnEvent(
  eventName: string,
  jsonData: string,
): TeachingTurnEvent | null {
  const knownEvents = new Set([
    'turn.accepted',
    'message.delta',
    'message.citation',
    'turn.completed',
    'turn.failed',
    'turn.cancelled',
    'tool.started',
    'tool.completed',
    'tool.failed',
  ]);
  if (!knownEvents.has(eventName)) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonData);
  } catch {
    throw new TurnStreamProtocolError(`${eventName} data is not valid JSON`);
  }
  if (!isRecord(parsed)) {
    throw new TurnStreamProtocolError(`${eventName} data is not an object`);
  }
  if (parsed.schemaVersion !== TURN_EVENT_SCHEMA_VERSION) {
    throw new TurnStreamProtocolError(
      `${eventName} schema version is unsupported`,
    );
  }
  if (parsed.type !== eventName) {
    throw new TurnStreamProtocolError(
      `${eventName} payload type does not match`,
    );
  }

  const turnId = readString(parsed, 'turnId', eventName);
  if (eventName === 'turn.accepted') {
    return {
      type: eventName,
      schemaVersion: TURN_EVENT_SCHEMA_VERSION,
      turnId,
      studentMessageId: readString(parsed, 'studentMessageId', eventName),
      assistantMessageId: readString(parsed, 'assistantMessageId', eventName),
      replayed: readBoolean(parsed, 'replayed', eventName),
    };
  }
  if (eventName === 'message.delta') {
    return {
      type: eventName,
      schemaVersion: TURN_EVENT_SCHEMA_VERSION,
      turnId,
      messageId: readString(parsed, 'messageId', eventName),
      delta: readString(parsed, 'delta', eventName, MAX_DELTA_LENGTH),
    };
  }
  if (eventName === 'message.citation') {
    return {
      type: eventName,
      schemaVersion: TURN_EVENT_SCHEMA_VERSION,
      turnId,
      messageId: readString(parsed, 'messageId', eventName),
      citationId: readString(parsed, 'citationId', eventName),
      sourceId: readString(parsed, 'sourceId', eventName),
      documentId: readString(parsed, 'documentId', eventName),
      chunkId: readString(parsed, 'chunkId', eventName),
      label: readString(parsed, 'label', eventName, 400),
      pageStart: readNullablePositiveInteger(parsed, 'pageStart', eventName),
      pageEnd: readNullablePositiveInteger(parsed, 'pageEnd', eventName),
    };
  }
  if (eventName === 'turn.completed') {
    return {
      type: eventName,
      schemaVersion: TURN_EVENT_SCHEMA_VERSION,
      turnId,
      messageId: readString(parsed, 'messageId', eventName),
    };
  }
  if (eventName === 'turn.failed') {
    return {
      type: eventName,
      schemaVersion: TURN_EVENT_SCHEMA_VERSION,
      turnId,
      messageId: readString(parsed, 'messageId', eventName),
      code: readString(parsed, 'code', eventName, MAX_CODE_LENGTH),
      message: readString(parsed, 'message', eventName, MAX_MESSAGE_LENGTH),
      retryable: readBoolean(parsed, 'retryable', eventName),
    };
  }
  if (eventName === 'turn.cancelled') {
    return {
      type: eventName,
      schemaVersion: TURN_EVENT_SCHEMA_VERSION,
      turnId,
      messageId: readString(parsed, 'messageId', eventName),
    };
  }

  const label =
    parsed.label === undefined
      ? undefined
      : readString(parsed, 'label', eventName, MAX_LABEL_LENGTH);
  const code =
    parsed.code === undefined
      ? undefined
      : readString(parsed, 'code', eventName, MAX_CODE_LENGTH);
  return {
    type: eventName as ToolLifecycleEvent['type'],
    schemaVersion: TURN_EVENT_SCHEMA_VERSION,
    turnId,
    toolCallId: readString(parsed, 'toolCallId', eventName),
    ...(label ? { label } : {}),
    ...(eventName === 'tool.failed' && code ? { code } : {}),
  };
}

interface SseFrame {
  eventName: string;
  data: string;
}

function parseFrame(frame: string): SseFrame | null {
  frame = frame.replace(/\r\n?/g, '\n');
  let eventName = 'message';
  const dataLines: string[] = [];
  for (const line of frame.split('\n')) {
    if (line.length === 0 || line.startsWith(':')) continue;
    const separator = line.indexOf(':');
    const field = separator === -1 ? line : line.slice(0, separator);
    let value = separator === -1 ? '' : line.slice(separator + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') eventName = value;
    if (field === 'data') dataLines.push(value);
  }
  if (dataLines.length === 0) return null;
  return { eventName, data: dataLines.join('\n') };
}

/** Consume a fetch Response as native SSE without vendor-specific events. */
export async function consumeTeachingTurnResponse(
  response: Response,
  onEvent: (event: TeachingTurnEvent) => void,
): Promise<void> {
  if (!response.ok) {
    throw new TurnStreamProtocolError(
      `turn request failed with ${response.status}`,
    );
  }
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  if (!contentType.includes('text/event-stream') || !response.body) {
    throw new TurnStreamProtocolError('turn response is not an SSE stream');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let responseTextLength = 0;
  let eventCount = 0;

  const dispatchFrame = (frame: string) => {
    if (frame.length > MAX_FRAME_LENGTH) {
      throw new TurnStreamProtocolError('turn event frame is too large');
    }
    const parsedFrame = parseFrame(frame);
    if (!parsedFrame) return;
    const event = parseTeachingTurnEvent(
      parsedFrame.eventName,
      parsedFrame.data,
    );
    if (event) {
      eventCount += 1;
      if (eventCount > MAX_EVENT_COUNT) {
        throw new TurnStreamProtocolError('turn response has too many events');
      }
      if (event.type === 'message.delta') {
        responseTextLength += event.delta.length;
        if (responseTextLength > MAX_RESPONSE_TEXT_LENGTH) {
          throw new TurnStreamProtocolError('turn response text is too large');
        }
      }
      onEvent(event);
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let match = /\r\n\r\n|\n\n|\r\r/.exec(buffer);
      while (match?.index !== undefined) {
        dispatchFrame(buffer.slice(0, match.index));
        buffer = buffer.slice(match.index + match[0].length);
        match = /\r\n\r\n|\n\n|\r\r/.exec(buffer);
      }
      if (buffer.length > MAX_BUFFER_LENGTH) {
        throw new TurnStreamProtocolError('turn event buffer is too large');
      }
      if (done) break;
    }
    if (buffer.trim().length > 0) dispatchFrame(buffer);
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
}
