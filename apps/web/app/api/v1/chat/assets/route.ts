import { readAnonymousIdentity } from '@/server/identity/anonymous-identity';
import {
  AssetUploadError,
  listOwnedSpaceAssetsPage,
  uploadOwnedAssetToSpace,
} from '@/server/assets/asset-upload';
import {
  assetUploadErrorResponse,
  parseAssetUploadRequest,
} from '@/server/assets/asset-upload-http';
import { loadOwnedGeneralConversation } from '@/server/platform/general-conversation';
import {
  isTrustedSameOriginWrite,
  jsonError,
  jsonResponse,
} from '@/server/http/request-security';
import {
  encodeTemporalCursor,
  PaginationRequestError,
  parseListPagination,
} from '@/server/http/pagination';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function loadContext() {
  const identity = await readAnonymousIdentity();
  if (!identity) return null;
  const conversation = await loadOwnedGeneralConversation(identity);
  return conversation ? { identity, conversation } : null;
}

export async function GET(request?: Request): Promise<Response> {
  const context = await loadContext();
  if (!context) return jsonError(401, 'unauthorized', '请先开始对话。');
  try {
    const pagination = parseListPagination(request);
    const page = await listOwnedSpaceAssetsPage(
      context.identity,
      context.conversation.spaceId,
      pagination,
    );
    return jsonResponse({
      assets: page.items,
      page: { nextCursor: encodeTemporalCursor(page.nextCursor) },
    });
  } catch (error) {
    if (error instanceof PaginationRequestError) {
      return jsonError(400, error.code, '分页参数不正确。');
    }
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
    const upload = await parseAssetUploadRequest(request);
    if (upload instanceof Response) return upload;
    const asset = await uploadOwnedAssetToSpace({
      identity: context.identity,
      spaceId: context.conversation.spaceId,
      ...upload,
    });
    return jsonResponse({ asset }, { status: 201 });
  } catch (error) {
    if (error instanceof AssetUploadError) {
      return assetUploadErrorResponse(error);
    }
    return jsonError(503, 'asset_upload_unavailable', '文件上传暂时不可用。');
  }
}
