import { readAnonymousIdentity } from '@/server/identity/anonymous-identity';
import { jsonError } from '@/server/http/request-security';
import { loadOwnedGeneralConversation } from '@/server/platform/general-conversation';
import {
  AssetPreviewError,
  readOwnedAssetPreviewFile,
} from '@/server/assets/asset-preview';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const paramsSchema = z.object({ assetId: z.string().uuid() }).strict();

function encodeFileName(value: string): string {
  return encodeURIComponent(value).replace(
    /['()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ assetId: string }> },
): Promise<Response> {
  const parsed = paramsSchema.safeParse(await context.params);
  if (!parsed.success) {
    return jsonError(404, 'asset_not_found', '来源不存在。');
  }
  const identity = await readAnonymousIdentity();
  if (!identity) return jsonError(401, 'unauthorized', '请先开始对话。');
  const conversation = await loadOwnedGeneralConversation(identity);
  if (!conversation) return jsonError(401, 'unauthorized', '请先开始对话。');
  try {
    const file = await readOwnedAssetPreviewFile({
      identity,
      spaceId: conversation.spaceId,
      assetId: parsed.data.assetId,
    });
    return new Response(Buffer.from(file.bytes), {
      headers: {
        'cache-control': 'private, no-store',
        'content-disposition': `inline; filename*=UTF-8''${encodeFileName(file.fileName)}`,
        'content-type': file.mimeType,
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (error) {
    if (error instanceof AssetPreviewError) {
      return jsonError(
        error.status,
        error.code,
        error.status === 404 ? '来源不存在。' : '这个来源暂时不能预览。',
      );
    }
    return jsonError(503, 'preview_unavailable', '来源预览暂时不可用。');
  }
}
