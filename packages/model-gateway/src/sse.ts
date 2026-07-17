const MAX_SSE_EVENT_CHARACTERS = 1_048_576;

/** 只暴露稳定协议码，不把畸形事件正文带入异常。 */
export class SseProtocolError extends Error {
  override readonly name = 'SseProtocolError';

  constructor() {
    super('invalid_response');
  }
}

/** 按 WHATWG SSE 行规则读取 data 字段，正确处理任意网络分块与 CRLF。 */
export async function* readSseData(
  stream: ReadableStream<Uint8Array>,
): AsyncIterable<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let dataLines: string[] = [];

  const consumeLine = (lineWithOptionalCr: string): string | null => {
    const line = lineWithOptionalCr.endsWith('\r')
      ? lineWithOptionalCr.slice(0, -1)
      : lineWithOptionalCr;
    if (line === '') {
      if (dataLines.length === 0) return null;
      const event = dataLines.join('\n');
      dataLines = [];
      return event;
    }
    if (line.startsWith(':')) return null;
    const separator = line.indexOf(':');
    const field = separator === -1 ? line : line.slice(0, separator);
    let value = separator === -1 ? '' : line.slice(separator + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'data') {
      dataLines.push(value);
      if (dataLines.join('\n').length > MAX_SSE_EVENT_CHARACTERS) {
        throw new SseProtocolError();
      }
    }
    return null;
  };

  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      pending += decoder.decode(chunk.value, { stream: true });
      if (pending.length > MAX_SSE_EVENT_CHARACTERS * 2) {
        throw new SseProtocolError();
      }
      let newline = pending.indexOf('\n');
      while (newline !== -1) {
        const event = consumeLine(pending.slice(0, newline));
        pending = pending.slice(newline + 1);
        if (event !== null) yield event;
        newline = pending.indexOf('\n');
      }
    }

    pending += decoder.decode();
    if (pending.length > 0) {
      const event = consumeLine(pending);
      if (event !== null) yield event;
    }
    if (dataLines.length > 0) yield dataLines.join('\n');
  } finally {
    reader.releaseLock();
  }
}
