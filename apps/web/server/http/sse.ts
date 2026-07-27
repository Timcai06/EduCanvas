/**
 * SSE（Server-Sent Events）编码工具。
 *
 * ## 安全约束
 *
 * - 事件名只能包含小写字母和点号（如 `message.delta`），拒绝换行注入
 * - 事件数据通过 JSON.stringify 序列化，不是字符串拼接
 * - 响应头包含 `x-accel-buffering: no` 禁用 Nginx 代理缓冲
 *
 * ## 客户端断开处理
 *
 * `createSseEventStream` 不因客户端断开而终止业务生成。
 * 客户端 `clientOpen = false` 只停止写响应，服务端继续生成并持久化。
 * 这保证用户关掉浏览器重开后可以通过 replay 拿到完整结果。
 */

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
  return encoder.encode(
    `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
  );
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

/** 客户端断开只停止写响应；业务生成与持久化继续由服务端完成。 */
export function createSseEventStream<T extends object & { type: string }>(
  events: AsyncIterable<T>,
): ReadableStream<Uint8Array> {
  let clientOpen = true;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      void (async () => {
        try {
          for await (const event of events) {
            if (clientOpen) controller.enqueue(encodeSseEvent(event));
          }
          if (clientOpen) controller.close();
        } catch (error) {
          if (clientOpen) controller.error(error);
        }
      })();
    },
    cancel() {
      clientOpen = false;
    },
  });
}
