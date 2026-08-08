const MAX_TEXT_BYTES = 2_048;

/** 构造 turn 请求负载；空白或超过 2048 字节（与后端 MAX_TEXT_BYTES 一致）返回 null。 */
export function buildTurnRequest(
  text: string,
): { text: string; clientMessageId: string } | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (new TextEncoder().encode(trimmed).length > MAX_TEXT_BYTES) return null;
  return { text: trimmed, clientMessageId: crypto.randomUUID() };
}
