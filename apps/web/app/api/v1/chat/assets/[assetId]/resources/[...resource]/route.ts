import {
  AssetResourceError,
  readOwnedAssetResource,
} from '@/server/assets/asset-derived-resources';
import { jsonError } from '@/server/http/request-security';
import { readAnonymousIdentity } from '@/server/identity/anonymous-identity';
import { loadOwnedGeneralConversation } from '@/server/platform/general-conversation';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** catch-all 段承载 manifest 相对路径（images/001.jpg 含斜杠）。 */
const paramsSchema = z
  .object({
    assetId: z.string().uuid(),
    resource: z.array(z.string()).min(1),
  })
  .strict();

export async function GET(
  _request: Request,
  context: { params: Promise<{ assetId: string; resource: string[] }> },
): Promise<Response> {
  const parsed = paramsSchema.safeParse(await context.params);
  if (!parsed.success) {
    return jsonError(404, 'resource_not_found');
  }
  const identity = await readAnonymousIdentity();
  if (!identity) return jsonError(401, 'unauthorized');
  const conversation = await loadOwnedGeneralConversation(identity);
  if (!conversation) return jsonError(401, 'unauthorized');
  try {
    const resource = await readOwnedAssetResource({
      identity,
      spaceId: conversation.spaceId,
      assetId: parsed.data.assetId,
      resourcePath: parsed.data.resource.join('/'),
    });
    return new Response(Buffer.from(resource.bytes), {
      headers: {
        'cache-control': 'private, no-store',
        'content-type': resource.mimeType,
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (error) {
    if (error instanceof AssetResourceError) {
      return jsonError(error.status, error.code);
    }
    return jsonError(503, 'resource_unavailable');
  }
}
