export class DashScopeInvalidResponseError extends Error {
  constructor() {
    super('dashscope_invalid_response');
    this.name = 'DashScopeInvalidResponseError';
  }
}

export async function readBoundedJson(
  response: Response,
  maxBytes: number,
): Promise<unknown> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes)
    throw new DashScopeInvalidResponseError();
  if (!response.body) throw new DashScopeInvalidResponseError();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new DashScopeInvalidResponseError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch (cause) {
    throw new DashScopeInvalidResponseError();
  }
}
