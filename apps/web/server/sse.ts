import 'server-only';

const SSE_EVENT_NAME = /^[a-z]+(?:\.[a-z]+)*$/;
const encoder = new TextEncoder();

/** 只编码 EduCanvas 自有事件；事件名不能注入换行或任意 SSE 字段。 */
export function encodeSseEvent<T extends object & { type: string }>(
  event: T,
): Uint8Array {
  if (!SSE_EVENT_NAME.test(event.type)) {
    throw new Error('invalid_sse_event_name');
  }
  return encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
}

export function sseResponse(stream: ReadableStream<Uint8Array>): Response {
  return new Response(stream, {
    headers: {
      'cache-control': 'no-cache, no-store, no-transform',
      'content-type': 'text/event-stream; charset=utf-8',
      'x-accel-buffering': 'no',
    },
  });
}
