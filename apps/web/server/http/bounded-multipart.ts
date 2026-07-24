import 'server-only';

export class BoundedMultipartError extends Error {
  constructor(readonly code: 'invalid_multipart' | 'multipart_too_large') {
    super(code);
    this.name = 'BoundedMultipartError';
  }
}

/**
 * 在调用平台 multipart 解析器前先流式执行总请求硬上限。
 * maxBytes 包含 boundary 和普通字段，避免缺失或伪造 Content-Length 时无界缓冲。
 */
export async function readBoundedMultipartFormData(
  request: Request,
  maxBytes: number,
): Promise<FormData> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new Error('multipart_limit_invalid');
  }
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().startsWith('multipart/form-data;')) {
    throw new BoundedMultipartError('invalid_multipart');
  }
  const declaredLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new BoundedMultipartError('multipart_too_large');
  }
  if (!request.body) throw new BoundedMultipartError('invalid_multipart');

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel('multipart_too_large').catch(() => undefined);
        throw new BoundedMultipartError('multipart_too_large');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return await new Response(body, {
      headers: { 'content-type': contentType },
    }).formData();
  } catch {
    throw new BoundedMultipartError('invalid_multipart');
  }
}
