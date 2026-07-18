import { readAnonymousIdentity } from '@/server/identity/anonymous-identity';
import { loadOwnedGeneralConversation } from '@/server/platform/general-conversation';
import { jsonError } from '@/server/http/request-security';
import {
  ArtifactOwnershipError,
  DrizzlePlatformArtifactRepository,
} from '@educanvas/db';
import { audioOverviewMetadataSchema } from '@educanvas/canvas-protocol';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 产物详情:结构化 JSONB 直接返回；媒体版本只返回受控读取 URL 与公开
 * metadata，绝不返回私有 objectKey/checksum。越权与不存在同错(404)。
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ artifactId: string }> },
): Promise<Response> {
  const { artifactId } = await params;
  if (!UUID_PATTERN.test(artifactId)) {
    return jsonError(404, 'artifact_not_found', '产物不存在。');
  }
  const identity = await readAnonymousIdentity();
  if (!identity) return jsonError(401, 'unauthorized', '请先开始对话。');
  const conversation = await loadOwnedGeneralConversation(identity);
  if (!conversation) return jsonError(401, 'unauthorized', '请先开始对话。');

  try {
    const repository = new DrizzlePlatformArtifactRepository();
    const detail = await repository.getArtifactDetail({
      artifactId,
      trustedSubjectId: identity.studentId,
    });
    const audioMetadata =
      detail.artifact.kind === 'audio_overview' && detail.latestVersion
        ? audioOverviewMetadataSchema.safeParse(detail.latestVersion.metadata)
        : null;
    return Response.json({
      artifact: {
        id: detail.artifact.id,
        kind: detail.artifact.kind,
        trustTier: detail.artifact.trustTier,
        title: detail.artifact.title,
        status: detail.artifact.status,
        latestVersion: detail.artifact.latestVersion,
        updatedAt: detail.artifact.updatedAt,
      },
      latestVersion: detail.latestVersion
        ? {
            version: detail.latestVersion.version,
            content: detail.latestVersion.content,
            media:
              audioMetadata?.success === true
                ? {
                    url: `/api/v1/chat/artifacts/${encodeURIComponent(artifactId)}/audio`,
                    ...audioMetadata.data,
                  }
                : null,
          }
        : null,
      latestJob: detail.latestJob
        ? {
            id: detail.latestJob.id,
            status: detail.latestJob.status,
            progress: detail.latestJob.progress,
            failureCode: detail.latestJob.failureCode,
          }
        : null,
    });
  } catch (error) {
    if (error instanceof ArtifactOwnershipError) {
      return jsonError(404, 'artifact_not_found', '产物不存在。');
    }
    return jsonError(503, 'artifact_detail_unavailable', '暂时无法读取产物。');
  }
}
