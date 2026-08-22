import {
  parseTeachingTurnEvent,
  TurnStreamProtocolError,
  type TeachingTurnEvent,
} from './turn-events';

const MAX_FRAME_LENGTH = 65_536;
const MAX_BUFFER_LENGTH = 131_072;
const MAX_RESPONSE_TEXT_LENGTH = 1_000_000;
const MAX_EVENT_COUNT = 4_096;

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
  let terminalReceived = false;

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
    if (!event) return;
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
    terminalReceived ||=
      event.type === 'turn.completed' ||
      event.type === 'turn.failed' ||
      event.type === 'turn.cancelled';
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
      if (terminalReceived) {
        await reader.cancel().catch(() => undefined);
        break;
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
