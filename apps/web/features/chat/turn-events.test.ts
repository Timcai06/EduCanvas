import { describe, expect, it, vi } from 'vitest';
import {
  consumeTeachingTurnResponse,
  parseTeachingTurnEvent,
  TurnStreamProtocolError,
} from './turn-events';

function responseFromChunks(chunks: readonly string[]): {
  response: Response;
  stream: ReadableStream<Uint8Array>;
} {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return {
    stream,
    response: new Response(stream, {
      headers: { 'content-type': 'text/event-stream; charset=utf-8' },
    }),
  };
}

describe('teaching turn SSE protocol', () => {
  it('parses split CRLF frames and only emits provider-neutral events', async () => {
    const accepted = JSON.stringify({
      type: 'turn.accepted',
      schemaVersion: '1',
      turnId: 'turn-1',
      studentMessageId: 'student-1',
      assistantMessageId: 'assistant-1',
      replayed: false,
    });
    const tool = JSON.stringify({
      type: 'tool.started',
      schemaVersion: '1',
      turnId: 'turn-1',
      toolCallId: 'tool-1',
      label: '查找本课资料',
    });
    const delta = JSON.stringify({
      type: 'message.delta',
      schemaVersion: '1',
      turnId: 'turn-1',
      messageId: 'assistant-1',
      delta: '先观察耳朵。',
    });
    const completed = JSON.stringify({
      type: 'turn.completed',
      schemaVersion: '1',
      turnId: 'turn-1',
      messageId: 'assistant-1',
    });
    const payload =
      `: heartbeat\r\nevent: turn.accepted\r\ndata: ${accepted}\r\n\r\n` +
      `event: tool.started\r\ndata: ${tool}\r\n\r\n` +
      `event: message.delta\r\ndata: ${delta}\r\n\r\n` +
      `event: turn.completed\r\ndata: ${completed}\r\n\r\n`;
    const chunks = [payload.slice(0, 31), payload.slice(31, 97), payload.slice(97)];
    const { response, stream } = responseFromChunks(chunks);
    const onEvent = vi.fn();

    await consumeTeachingTurnResponse(response, onEvent);

    expect(onEvent.mock.calls.map(([event]) => event.type)).toEqual([
      'turn.accepted',
      'tool.started',
      'message.delta',
      'turn.completed',
    ]);
    expect(onEvent.mock.calls[2]?.[0]).toMatchObject({
      delta: '先观察耳朵。',
      messageId: 'assistant-1',
    });
    expect(stream.locked).toBe(false);
  });

  it('ignores unknown additive events', () => {
    expect(
      parseTeachingTurnEvent(
        'citation.added',
        JSON.stringify({ type: 'citation.added', schemaVersion: '1' }),
      ),
    ).toBeNull();
  });

  it.each([
    [
      'payload type mismatch',
      'message.delta',
      {
        type: 'turn.completed',
        schemaVersion: '1',
        turnId: 'turn-1',
        messageId: 'assistant-1',
        delta: 'x',
      },
    ],
    [
      'empty delta',
      'message.delta',
      {
        type: 'message.delta',
        schemaVersion: '1',
        turnId: 'turn-1',
        messageId: 'assistant-1',
        delta: '',
      },
    ],
    [
      'unsupported version',
      'turn.completed',
      {
        type: 'turn.completed',
        schemaVersion: '2',
        turnId: 'turn-1',
        messageId: 'assistant-1',
      },
    ],
  ])('rejects %s', (_label, eventName, data) => {
    expect(() =>
      parseTeachingTurnEvent(eventName, JSON.stringify(data)),
    ).toThrow(TurnStreamProtocolError);
  });

  it('bounds a frame without a delimiter and releases the reader', async () => {
    const { response, stream } = responseFromChunks(['x'.repeat(131_073)]);

    await expect(
      consumeTeachingTurnResponse(response, () => undefined),
    ).rejects.toThrow('buffer is too large');
    expect(stream.locked).toBe(false);
  });
});
