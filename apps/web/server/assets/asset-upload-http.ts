import 'server-only';

import { jsonError } from '../http/request-security';
import { AssetUploadError, MAX_UPLOAD_BYTES } from './asset-upload';

const MAX_MULTIPART_OVERHEAD_BYTES = 256 * 1024;
const MAX_MULTIPART_BODY_BYTES =
  MAX_UPLOAD_BYTES + MAX_MULTIPART_OVERHEAD_BYTES;

export type ParsedAssetUpload = {
  file: File;
  scope: 'turn' | 'space';
};

async function readLimitedMultipartRequest(request: Request): Promise<Request> {
  const contentLength = request.headers.get('content-length');
  if (contentLength !== null) {
    const parsed = Number(contentLength);
    if (!Number.isSafeInteger(parsed) || parsed < 0) {
      throw new AssetUploadError('invalid_upload', 400);
    }
    if (parsed > MAX_MULTIPART_BODY_BYTES) {
      throw new AssetUploadError('file_too_large', 413);
    }
  }
  if (!request.body) throw new AssetUploadError('invalid_upload', 400);

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      byteLength += result.value.byteLength;
      if (byteLength > MAX_MULTIPART_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new AssetUploadError('file_too_large', 413);
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new Request(request.url, {
    method: request.method,
    headers: request.headers,
    body,
  });
}

export async function parseAssetUploadRequest(
  request: Request,
): Promise<ParsedAssetUpload | Response> {
  const contentType = request.headers.get('content-type')?.toLowerCase() ?? '';
  if (!contentType.startsWith('multipart/form-data;')) {
    return jsonError(415, 'invalid_upload', '上传必须使用表单格式。');
  }
  let form: FormData;
  try {
    form = await (await readLimitedMultipartRequest(request)).formData();
  } catch (error) {
    if (error instanceof AssetUploadError) {
      return assetUploadErrorResponse(error);
    }
    return jsonError(400, 'invalid_upload', '上传参数不完整。');
  }
  const file = form.get('file');
  const scope = form.get('scope');
  if (!(file instanceof File) || (scope !== 'turn' && scope !== 'space')) {
    return jsonError(400, 'invalid_upload', '上传参数不完整。');
  }
  return { file, scope };
}

export function assetUploadErrorResponse(error: AssetUploadError): Response {
  const message = (() => {
    switch (error.code) {
      case 'file_too_large':
        return '文件不能超过10MB。';
      case 'unsupported_file_type':
        return '目前只支持PDF、PNG、JPEG和WebP。';
      case 'pdf_text_unavailable':
        return '这个PDF没有可读取文本；扫描版PDF将在OCR能力上线后支持。';
      case 'session_not_found':
        return '当前对话空间不存在。';
      default:
        return '文件格式不正确。';
    }
  })();
  return jsonError(error.status, error.code, message);
}
