import { readAnonymousIdentity } from '@/server/identity/anonymous-identity';
import {
  AssetUploadError,
  listOwnedAssets,
  uploadOwnedAsset,
} from '@/server/assets/asset-upload';
import {
  assetUploadErrorResponse,
  parseAssetUploadRequest,
} from '@/server/assets/asset-upload-http';
import {
  isTrustedSameOriginWrite,
  jsonError,
} from '@/server/http/request-security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const identity = await readAnonymousIdentity();
  if (!identity) return jsonError(401, 'unauthorized', '请先开始对话。');
  try {
    return Response.json({ assets: await listOwnedAssets(identity) });
  } catch (error) {
    if (error instanceof AssetUploadError) {
      return assetUploadErrorResponse(error);
    }
    return jsonError(503, 'asset_list_unavailable', '暂时无法读取资料。');
  }
}

export async function POST(request: Request): Promise<Response> {
  if (!isTrustedSameOriginWrite(request)) {
    return jsonError(403, 'forbidden_origin', '请求来源不受信任。');
  }
  const identity = await readAnonymousIdentity();
  if (!identity) return jsonError(401, 'unauthorized', '请先开始对话。');
  try {
    const upload = await parseAssetUploadRequest(request);
    if (upload instanceof Response) return upload;
    const asset = await uploadOwnedAsset({ identity, ...upload });
    return Response.json({ asset }, { status: 201 });
  } catch (error) {
    if (error instanceof AssetUploadError) {
      return assetUploadErrorResponse(error);
    }
    return jsonError(503, 'asset_upload_unavailable', '文件上传暂时不可用。');
  }
}
