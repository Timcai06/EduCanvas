import 'server-only';

import {
  BoundedMultipartError,
  readBoundedMultipartFormData,
} from '../http/bounded-multipart';
import { jsonError } from '../http/request-security';
import { AssetUploadError, MAX_UPLOAD_BYTES } from './asset-upload';

const MAX_MULTIPART_OVERHEAD_BYTES = 256 * 1024;
const MAX_MULTIPART_BODY_BYTES =
  MAX_UPLOAD_BYTES + MAX_MULTIPART_OVERHEAD_BYTES;

export type ParsedAssetUpload = {
  file: File;
  scope: 'turn' | 'space';
};

export async function parseAssetUploadRequest(
  request: Request,
): Promise<ParsedAssetUpload | Response> {
  const contentType = request.headers.get('content-type')?.toLowerCase() ?? '';
  if (!contentType.startsWith('multipart/form-data;')) {
    return jsonError(415, 'invalid_upload', '上传必须使用表单格式。');
  }
  let form: FormData;
  try {
    form = await readBoundedMultipartFormData(
      request,
      MAX_MULTIPART_BODY_BYTES,
    );
  } catch (error) {
    if (error instanceof BoundedMultipartError) {
      return error.code === 'multipart_too_large'
        ? assetUploadErrorResponse(new AssetUploadError('file_too_large', 413))
        : jsonError(400, 'invalid_upload', '上传参数不完整。');
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
