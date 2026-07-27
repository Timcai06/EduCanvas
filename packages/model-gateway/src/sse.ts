/**
 * SSE 流解析 — 按 WHATWG SSE 标准读取供应商返回的 data 字段。
 *
 * ## 为什么需要自定义解析
 *
 * 供应商 SSE 流可能被网络分块成任意大小的 TCP 包。
 * 本解析器正确处理 CRLF 行尾、空行事件边界、多行 data 拼接。
 * 最大单事件 1MB — 超出则抛 SseProtocolError，拒绝资源耗尽攻击。
 *
 * ## 错误安全
 *
 * 只暴露 SseProtocolError（含稳定协议码），不把畸形事件正文带入异常消息。
 * 这防止供应商返回的异常内容泄漏到日志或响应中。
 */

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
