import { readAnonymousIdentity } from '@/server/identity/anonymous-identity';
import { loadOwnedGeneralConversation } from '@/server/platform/general-conversation';
import { tombstoneOwnedAsset } from '@/server/assets/asset-upload';
import {
  isTrustedSameOriginWrite,
  jsonError,
} from '@/server/http/request-security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 软删除指定资产：将资产及其所有版本标记为 tombstoned。
 * 越权同 404——不泄露资产是否存在。
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ assetId: string }> },
): Promise<Response> {
  if (!isTrustedSameOriginWrite(request)) {
    return jsonError(403, 'forbidden_origin', '请求来源不受信任。');
  }
  const { assetId } = await params;
  if (!UUID_PATTERN.test(assetId)) {
    return jsonError(404, 'asset_not_found', '文件不存在。');
  }
  const identity = await readAnonymousIdentity();
  if (!identity) return jsonError(401, 'unauthorized', '请先开始对话。');
  const conversation = await loadOwnedGeneralConversation(identity);
  if (!conversation) return jsonError(401, 'unauthorized', '请先开始对话。');

  try {
    const deleted = await tombstoneOwnedAsset({
      identity,
      spaceId: conversation.spaceId,
      assetId,
    });
    if (!deleted) {
      return jsonError(404, 'asset_not_found', '文件不存在。');
    }
    return Response.json({ deleted: true });
  } catch {
    return jsonError(503, 'asset_delete_unavailable', '暂时无法删除文件。');
  }
}
