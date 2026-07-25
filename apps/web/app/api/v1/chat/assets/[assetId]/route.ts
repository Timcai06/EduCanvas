import { readAnonymousIdentity } from '@/server/identity/anonymous-identity';
import {
  isTrustedSameOriginWrite,
  jsonError,
} from '@/server/http/request-security';
import { loadOwnedGeneralConversation } from '@/server/platform/general-conversation';
import {
  AssetPreviewError,
  tombstoneOwnedAsset,
} from '@/server/assets/asset-preview';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const paramsSchema = z.object({ assetId: z.string().uuid() }).strict();

export async function DELETE(
  request: Request,
  context: { params: Promise<{ assetId: string }> },
): Promise<Response> {
  if (!isTrustedSameOriginWrite(request)) {
    return jsonError(403, 'forbidden_origin', '请求来源不受信任。');
  }
  const parsed = paramsSchema.safeParse(await context.params);
  if (!parsed.success) {
    return jsonError(404, 'asset_not_found', '来源不存在。');
  }
  const identity = await readAnonymousIdentity();
  if (!identity) return jsonError(401, 'unauthorized', '请先开始对话。');
  const conversation = await loadOwnedGeneralConversation(identity);
  if (!conversation) return jsonError(401, 'unauthorized', '请先开始对话。');
  try {
    await tombstoneOwnedAsset({
      identity,
      spaceId: conversation.spaceId,
      assetId: parsed.data.assetId,
    });
    return new Response(null, { status: 204 });
  } catch (error) {
    if (error instanceof AssetPreviewError) {
      return jsonError(error.status, error.code, '来源不存在。');
    }
    return jsonError(503, 'asset_delete_unavailable', '暂时无法删除来源。');
  }
}
