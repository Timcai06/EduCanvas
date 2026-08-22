import { readAnonymousIdentity } from '@/server/identity/anonymous-identity';
import { jsonError } from '@/server/http/request-security';
import { loadOwnedGeneralConversation } from '@/server/platform/general-conversation';
import {
  AssetPreviewError,
  readOwnedAssetDownload,
  readOwnedAssetPreviewFile,
} from '@/server/assets/asset-preview';
import {
  CanvasResourceAccessError,
  loadOwnedCanvasResource,
} from '@/server/canvas/resource-access';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const paramsSchema = z.object({ assetId: z.string().uuid() }).strict();

/** 仅接受字面 download=1；其他值一律按内联预览处理。 */
const downloadQuerySchema = z.object({ download: z.literal('1') }).strict();

function encodeFileName(value: string): string {
  return encodeURIComponent(value).replace(
    /['()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export async function GET(
  request: Request,
  context: { params: Promise<{ assetId: string }> },
): Promise<Response> {
  const parsed = paramsSchema.safeParse(await context.params);
  if (!parsed.success) {
    return jsonError(404, 'asset_not_found');
  }
  const download = downloadQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  ).success;
  const identity = await readAnonymousIdentity();
  if (!identity) return jsonError(401, 'unauthorized');
  const conversation = await loadOwnedGeneralConversation(identity);
  if (!conversation) return jsonError(401, 'unauthorized');
  try {
    /* ADR-0026 决定 1：download=1 走原件下载（任意 MIME，校验 contentHash），
       其余请求保持内联预览语义（二进制白名单）。 */
    if (download) {
      const resource = await loadOwnedCanvasResource({
        identity,
        notebookId: conversation.spaceId,
        resourceKind: 'source',
        resourceId: parsed.data.assetId,
      });
      if (!resource.allowedActions.includes('download')) {
        return jsonError(403, 'forbidden');
      }
    }
    const file = download
      ? await readOwnedAssetDownload({
          identity,
          spaceId: conversation.spaceId,
          assetId: parsed.data.assetId,
        })
      : await readOwnedAssetPreviewFile({
          identity,
          spaceId: conversation.spaceId,
          assetId: parsed.data.assetId,
        });
    return new Response(Buffer.from(file.bytes), {
      headers: {
        'cache-control': 'private, no-store',
        'content-disposition': `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeFileName(file.fileName)}`,
        'content-type': file.mimeType,
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (error) {
    if (error instanceof CanvasResourceAccessError) {
      return jsonError(error.status, error.code);
    }
    if (error instanceof AssetPreviewError) {
      return jsonError(error.status, error.code);
    }
    return jsonError(503, 'preview_unavailable');
  }
}
