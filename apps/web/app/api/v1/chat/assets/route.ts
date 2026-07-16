import { readAnonymousIdentity } from '@/server/anonymous-identity';
import {
  AssetUploadError,
  listOwnedSpaceAssets,
  uploadOwnedAssetToSpace,
} from '@/server/asset-upload';
import { loadOwnedGeneralConversation } from '@/server/general-conversation';
import { isTrustedSameOriginWrite, jsonError } from '@/server/request-security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function publicMessage(error: AssetUploadError): string {
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
}

async function loadContext() {
  const identity = await readAnonymousIdentity();
  if (!identity) return null;
  const conversation = await loadOwnedGeneralConversation(identity);
  return conversation ? { identity, conversation } : null;
}

export async function GET(): Promise<Response> {
  const context = await loadContext();
  if (!context) return jsonError(401, 'unauthorized', '请先开始对话。');
  try {
    return Response.json({
      assets: await listOwnedSpaceAssets(
        context.identity,
        context.conversation.spaceId,
      ),
    });
  } catch {
    return jsonError(503, 'asset_list_unavailable', '暂时无法读取资料。');
  }
}

export async function POST(request: Request): Promise<Response> {
  if (!isTrustedSameOriginWrite(request)) {
    return jsonError(403, 'forbidden_origin', '请求来源不受信任。');
  }
  const context = await loadContext();
  if (!context) return jsonError(401, 'unauthorized', '请先开始对话。');
  try {
    const contentType =
      request.headers.get('content-type')?.toLowerCase() ?? '';
    if (!contentType.startsWith('multipart/form-data;')) {
      return jsonError(415, 'invalid_upload', '上传必须使用表单格式。');
    }
    const form = await request.formData();
    const file = form.get('file');
    const scope = form.get('scope');
    if (!(file instanceof File) || (scope !== 'turn' && scope !== 'space')) {
      return jsonError(400, 'invalid_upload', '上传参数不完整。');
    }
    const asset = await uploadOwnedAssetToSpace({
      identity: context.identity,
      spaceId: context.conversation.spaceId,
      file,
      scope,
    });
    return Response.json({ asset }, { status: 201 });
  } catch (error) {
    if (error instanceof AssetUploadError) {
      return jsonError(error.status, error.code, publicMessage(error));
    }
    return jsonError(503, 'asset_upload_unavailable', '文件上传暂时不可用。');
  }
}
