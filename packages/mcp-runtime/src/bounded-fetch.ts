import { McpInvocationError } from './errors';

export const MAX_MCP_RESPONSE_BYTES = 2 * 1024 * 1024;

/** 对SDK的每条HTTP响应流施加上限，避免Content-Length缺失时无界读入内存。 */
export function createBoundedFetch(
  maximumBytes = MAX_MCP_RESPONSE_BYTES,
): typeof fetch {
  return async (input, init) => {
    const response = await fetch(input, init);
    const declared = Number(response.headers.get('content-length') ?? '0');
    if (Number.isFinite(declared) && declared > maximumBytes) {
      await response.body?.cancel().catch(() => undefined);
      throw new McpInvocationError('transport');
    }
    if (!response.body) return response;
    let received = 0;
    const limited = response.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          received += chunk.byteLength;
          if (received > maximumBytes) {
            controller.error(new McpInvocationError('transport'));
            return;
          }
          controller.enqueue(chunk);
        },
      }),
    );
    return new Response(limited, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
}
