import { readAnonymousIdentity } from '@/server/identity/anonymous-identity';
import { jsonError } from '@/server/http/request-security';
import { loadOwnedGeneralConversation } from '@/server/platform/general-conversation';
import {
  PicturebookBundleError,
  loadPicturebookBundle,
  readPicturebookPage,
} from '@/server/canvas/picturebook-bundle';
import { ObjectStorageError } from '@educanvas/agent-core';
import {
  ArtifactOwnershipError,
  DrizzlePlatformArtifactRepository,
} from '@educanvas/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 逐页私有读取面；完整 bundle 与 imagePrompt 始终停留在服务端。 */
export async function GET(
  request: Request,
  {
    params,
  }: {
    params: Promise<{ artifactId: string; page: string }>;
  },
): Promise<Response> {
  const { artifactId, page } = await params;
  const pageNumber = Number(page);
  const versionNumber = Number(
    new URL(request.url).searchParams.get('version'),
  );
  if (
    !UUID_PATTERN.test(artifactId) ||
    !Number.isInteger(pageNumber) ||
    pageNumber < 1 ||
    pageNumber > 8 ||
    !Number.isSafeInteger(versionNumber) ||
    versionNumber < 1
  ) {
    return jsonError(404, 'artifact_not_found');
  }
  const identity = await readAnonymousIdentity();
  if (!identity) return jsonError(401, 'unauthorized');
  const conversation = await loadOwnedGeneralConversation(identity);
  if (!conversation) return jsonError(401, 'unauthorized');

  try {
    const repository = new DrizzlePlatformArtifactRepository();
    const artifact = await repository.getArtifact({
      artifactId,
      trustedSubjectId: identity.studentId,
    });
    if (
      artifact.spaceId !== conversation.spaceId ||
      artifact.status === 'archived' ||
      artifact.kind !== 'picturebook'
    ) {
      return jsonError(404, 'artifact_not_found');
    }
    const version = await repository.getVersion({
      artifactId,
      version: versionNumber,
      trustedSubjectId: identity.studentId,
    });
    const bundle = await loadPicturebookBundle({
      objectKey: version.objectKey,
      checksum: version.checksum,
    });
    if (pageNumber > bundle.pages.length) {
      return jsonError(404, 'artifact_not_found');
    }
    const image = readPicturebookPage(bundle, pageNumber);
    const body = new Uint8Array(image.bytes);
    return new Response(body.buffer, {
      status: 200,
      headers: {
        'cache-control': 'private, no-store',
        'content-type': image.contentType,
        'content-length': String(body.byteLength),
        'x-content-type-options': 'nosniff',
        'content-security-policy': "default-src 'none'; sandbox",
      },
    });
  } catch (error) {
    if (error instanceof ArtifactOwnershipError) {
      return jsonError(404, 'artifact_not_found');
    }
    if (
      error instanceof ObjectStorageError ||
      error instanceof PicturebookBundleError
    ) {
      return jsonError(503, 'picturebook_page_unavailable');
    }
    return jsonError(503, 'picturebook_page_unavailable');
  }
}
