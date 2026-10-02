import { DrizzlePlatformConversationRepository } from '@educanvas/db';
import { readAnonymousIdentity } from '@/server/identity/anonymous-identity';
import { isValidConversationId } from '@/server/platform/general-conversation';
import { listOwnedSpaceAssetsPage } from '@/server/assets/asset-upload';
import { jsonError, jsonResponse } from '@/server/http/request-security';
export const dynamic = 'force-dynamic';
export async function GET(
  _request: Request,
  context: { params: Promise<{ notebookId: string }> },
) {
  const identity = await readAnonymousIdentity();
  const { notebookId } = await context.params;
  if (!identity || !isValidConversationId(notebookId))
    return jsonError(404, 'resource_not_found');
  const notebook =
    await new DrizzlePlatformConversationRepository().getNotebook({
      notebookId,
      trustedSubjectId: identity.studentId,
    });
  if (!notebook) return jsonError(404, 'resource_not_found');
  const page = await listOwnedSpaceAssetsPage(identity, notebookId, {
    limit: 100,
    cursor: null,
  });
  return jsonResponse({
    sources: page.items
      .filter(
        (asset) =>
          asset.descriptor.scope === 'space' &&
          asset.descriptor.status === 'ready' &&
          asset.version?.status === 'ready',
      )
      .map((asset) => ({
        id: asset.descriptor.assetId,
        versionId: asset.version!.versionId,
        title: asset.descriptor.displayName,
      })),
  });
}
