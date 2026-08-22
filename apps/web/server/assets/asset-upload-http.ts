import 'server-only';

import {
  BoundedMultipartError,
  readBoundedMultipartFormData,
} from '../http/bounded-multipart';
import { jsonError } from '../http/request-security';
import {
  AssetUploadError,
  MAX_AUDIO_UPLOAD_BYTES,
  MAX_VIDEO_UPLOAD_BYTES,
} from './asset-upload';

const MAX_MULTIPART_OVERHEAD_BYTES = 256 * 1024;
const MAX_MULTIPART_BODY_BYTES =
  Math.max(MAX_AUDIO_UPLOAD_BYTES, MAX_VIDEO_UPLOAD_BYTES) +
  MAX_MULTIPART_OVERHEAD_BYTES;

export type ParsedAssetUpload = {
  file: File;
  scope: 'turn' | 'space';
};

export async function parseAssetUploadRequest(
  request: Request,
): Promise<ParsedAssetUpload | Response> {
  const contentType = request.headers.get('content-type')?.toLowerCase() ?? '';
  if (!contentType.startsWith('multipart/form-data;')) {
    return jsonError(415, 'invalid_upload');
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
        : jsonError(400, 'invalid_upload');
    }
    return jsonError(400, 'invalid_upload');
  }
  const file = form.get('file');
  const scope = form.get('scope');
  if (!(file instanceof File) || (scope !== 'turn' && scope !== 'space')) {
    return jsonError(400, 'invalid_upload');
  }
  return { file, scope };
}

export function assetUploadErrorResponse(error: AssetUploadError): Response {
  return jsonError(error.status, error.code);
}
