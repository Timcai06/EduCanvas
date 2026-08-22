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
  jsonResponse,
} from '@/server/http/request-security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const identity = await readAnonymousIdentity();
  if (!identity) return jsonError(401, 'unauthorized');
  try {
    return jsonResponse({ assets: await listOwnedAssets(identity) });
  } catch (error) {
    if (error instanceof AssetUploadError) {
      return assetUploadErrorResponse(error);
    }
    return jsonError(503, 'asset_list_unavailable');
  }
}

export async function POST(request: Request): Promise<Response> {
  if (!isTrustedSameOriginWrite(request)) {
    return jsonError(403, 'forbidden_origin');
  }
  const identity = await readAnonymousIdentity();
  if (!identity) return jsonError(401, 'unauthorized');
  try {
    const upload = await parseAssetUploadRequest(request);
    if (upload instanceof Response) return upload;
    const asset = await uploadOwnedAsset({ identity, ...upload });
    return jsonResponse({ asset }, { status: 201 });
  } catch (error) {
    if (error instanceof AssetUploadError) {
      return assetUploadErrorResponse(error);
    }
    return jsonError(503, 'asset_upload_unavailable');
  }
}
