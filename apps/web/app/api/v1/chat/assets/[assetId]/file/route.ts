import { readAnonymousIdentity } from '@/server/identity/anonymous-identity';
import { loadOwnedGeneralConversation } from '@/server/platform/general-conversation';
import { jsonError } from '@/server/http/request-security';
import { DrizzleAssetRepository } from '@educanvas/db';
import { readStoredAssetBytes } from '@/server/assets/asset-storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 获取资产原始文件二进制数据。PDF 用 pdf.js 客户端渲染需要完整文件流。
 * 越权同 404——不泄露资产是否存在。
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ assetId: string }> },
): Promise<Response> {
  const { assetId } = await params;
  if (!UUID_PATTERN.test(assetId)) {
    return jsonError(404, 'asset_not_found', '文件不存在。');
  }
  const identity = await readAnonymousIdentity();
  if (!identity) return jsonError(401, 'unauthorized', '请先开始对话。');
  const conversation = await loadOwnedGeneralConversation(identity);
  if (!conversation) return jsonError(401, 'unauthorized', '请先开始对话。');

  try {
    const repository = new DrizzleAssetRepository();
    const snapshots = await repository.listOwnedSpace({
      ownerSubjectId: identity.studentId,
      spaceId: conversation.spaceId,
    });
    const snapshot = snapshots.find(
      (s) => s.descriptor.assetId === assetId,
    );
    if (!snapshot?.version?.storageKey) {
      return jsonError(404, 'asset_not_found', '文件不存在。');
    }
    const result = await readStoredAssetBytes(snapshot.version.storageKey);
    if (!result) {
      return jsonError(404, 'asset_not_found', '文件不存在。');
    }
    return new Response(new Uint8Array(result), {
      headers: {
        'Content-Type': snapshot.descriptor.mimeType ?? 'application/octet-stream',
        'Content-Disposition': `inline; filename="${encodeURIComponent(snapshot.descriptor.displayName)}"`,
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch {
    return jsonError(503, 'asset_read_unavailable', '暂时无法读取文件。');
  }
}
