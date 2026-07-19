import { readAnonymousIdentity } from '@/server/identity/anonymous-identity';
import { loadOwnedGeneralConversation } from '@/server/platform/general-conversation';
import {
  isTrustedSameOriginWrite,
  jsonError,
} from '@/server/http/request-security';
import {
  ARTIFACT_GENERATE_TASK,
  ArtifactOwnershipError,
  ArtifactRevisionConflictError,
  DrizzlePlatformArtifactRepository,
} from '@educanvas/db';
import { audioOverviewMetadataSchema } from '@educanvas/canvas-protocol';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 产物详情:结构化 JSONB 直接返回；媒体版本只返回受控读取 URL 与公开
 * metadata，绝不返回私有 objectKey/checksum。越权与不存在同错(404)。
 */
export async function GET(
  request: Request,
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
    if (detail.artifact.spaceId !== conversation.spaceId) {
      throw new ArtifactOwnershipError();
    }
    const requestedVersion = new URL(request.url).searchParams.get('version');
    if (requestedVersion && !/^[1-9]\d*$/.test(requestedVersion)) {
      throw new ArtifactOwnershipError();
    }
    const requestedVersionNumber = requestedVersion
      ? Number(requestedVersion)
      : null;
    if (
      requestedVersionNumber !== null &&
      (!Number.isSafeInteger(requestedVersionNumber) ||
        requestedVersionNumber > 2_147_483_647)
    ) {
      throw new ArtifactOwnershipError();
    }
    const selectedVersion = requestedVersionNumber !== null
      ? await repository.getVersion({
          artifactId,
          version: requestedVersionNumber,
          trustedSubjectId: identity.studentId,
        })
      : detail.latestVersion;
    const versions = await repository.listVersions({
      artifactId,
      trustedSubjectId: identity.studentId,
    });
    const audioMetadata =
      detail.artifact.kind === 'audio_overview' && selectedVersion
        ? audioOverviewMetadataSchema.safeParse(selectedVersion.metadata)
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
      version: selectedVersion
        ? {
            version: selectedVersion.version,
            content: selectedVersion.content,
            media:
              audioMetadata?.success === true
                ? {
                    url: `/api/v1/chat/artifacts/${encodeURIComponent(artifactId)}/audio`,
                    ...audioMetadata.data,
                  }
                : null,
          }
        : null,
      versions: versions.map((version) => ({
        version: version.version,
        generatedBy: version.generatedBy,
        createdAt: version.createdAt,
      })),
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

const reviseArtifactSchema = z
  .object({
    baseVersion: z.number().int().min(1),
    instruction: z.string().trim().min(1).max(2_000),
  })
  .strict();

/** Canvas 共创：显式修改要求进入同一 Artifact 的持久生成任务。 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ artifactId: string }> },
): Promise<Response> {
  if (!isTrustedSameOriginWrite(request)) {
    return jsonError(403, 'forbidden_origin', '请求来源不受信任。');
  }
  const { artifactId } = await params;
  if (!UUID_PATTERN.test(artifactId)) {
    return jsonError(404, 'artifact_not_found', '产物不存在。');
  }
  const identity = await readAnonymousIdentity();
  if (!identity) return jsonError(401, 'unauthorized', '请先开始对话。');
  const conversation = await loadOwnedGeneralConversation(identity);
  if (!conversation) return jsonError(401, 'unauthorized', '请先开始对话。');

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, 'invalid_request', '请求格式不正确。');
  }
  const parsed = reviseArtifactSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, 'invalid_request', '修改要求不正确。');
  }

  try {
    const repository = new DrizzlePlatformArtifactRepository();
    const artifact = await repository.getArtifact({
      artifactId,
      trustedSubjectId: identity.studentId,
    });
    if (
      artifact.spaceId !== conversation.spaceId ||
      !['mind_map', 'slides', 'flashcards'].includes(artifact.kind)
    ) {
      throw new ArtifactOwnershipError();
    }
    const created = await repository.createRevisionGenerationJob({
      artifactId,
      conversationId: conversation.id,
      trustedSubjectId: identity.studentId,
      baseVersion: parsed.data.baseVersion,
      instruction: parsed.data.instruction,
      taskIdentifier: ARTIFACT_GENERATE_TASK,
    });
    return Response.json(
      {
        artifact: {
          id: created.artifact.id,
          kind: created.artifact.kind,
          trustTier: created.artifact.trustTier,
          title: created.artifact.title,
          status: created.artifact.status,
          latestVersion: created.artifact.latestVersion,
        },
        job: { id: created.job.id, status: created.job.status },
      },
      { status: 202 },
    );
  } catch (error) {
    if (error instanceof ArtifactRevisionConflictError) {
      return jsonError(409, error.code, error.message);
    }
    if (error instanceof ArtifactOwnershipError) {
      return jsonError(404, 'artifact_not_found', '产物不存在。');
    }
    return jsonError(
      503,
      'artifact_revision_unavailable',
      '暂时无法修改产物。',
    );
  }
}
