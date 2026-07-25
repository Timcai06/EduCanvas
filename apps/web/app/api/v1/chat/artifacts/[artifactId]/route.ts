import { readAnonymousIdentity } from '@/server/identity/anonymous-identity';
import { loadOwnedGeneralConversation } from '@/server/platform/general-conversation';
import {
  isTrustedSameOriginWrite,
  jsonError,
} from '@/server/http/request-security';
import {
  JsonRequestValidationError,
  jsonRequestErrorResponse,
  readLimitedJsonRequest,
} from '@/server/http/json-request';
import {
  ARTIFACT_GENERATE_TASK,
  ArtifactOwnershipError,
  ArtifactRevisionConflictError,
  DrizzlePlatformArtifactRepository,
} from '@educanvas/db';
import {
  audioOverviewMetadataSchema,
  NOTE_MARKDOWN_MAX_CHARS,
  noteContentSchema,
} from '@educanvas/canvas-protocol';
import {
  ArtifactResourceProjectionError,
  projectOwnedArtifactResource,
} from '@/server/canvas/artifact-resource-adapter';
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
    const selectedVersion =
      requestedVersionNumber !== null
        ? await repository.getVersion({
            artifactId,
            version: requestedVersionNumber,
            trustedSubjectId: identity.studentId,
          })
        : detail.latestVersion;
    const versions = await repository.listVersionProvenance({
      artifactId,
      trustedSubjectId: identity.studentId,
    });
    const audioMetadata =
      detail.artifact.kind === 'audio_overview' && selectedVersion
        ? audioOverviewMetadataSchema.safeParse(selectedVersion.metadata)
        : null;
    const canvasResource = projectOwnedArtifactResource({
      notebookId: conversation.spaceId,
      artifact: detail.artifact,
      version: selectedVersion,
      latestJob: detail.latestJob,
    });
    return Response.json({
      artifact: {
        id: detail.artifact.id,
        kind: detail.artifact.kind,
        trustTier: detail.artifact.trustTier,
        title: detail.artifact.title,
        status: detail.artifact.status,
        latestVersion: detail.artifact.latestVersion,
        createdAt: detail.artifact.createdAt,
        updatedAt: detail.artifact.updatedAt,
        /* 溯源:产物确由本笔记本对话生成时为 true。不泄露 conversationId 本身，
           只给 UI 一个可信的"从对话生长出来"标记。 */
        fromConversation: detail.artifact.conversationId !== null,
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
        revisionInstruction: version.revisionInstruction,
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
      canvasResource,
    });
  } catch (error) {
    if (error instanceof ArtifactOwnershipError) {
      return jsonError(404, 'artifact_not_found', '产物不存在。');
    }
    if (error instanceof ArtifactResourceProjectionError) {
      const status = error.code === 'resource_not_found' ? 404 : error.status;
      return jsonError(status, error.code, '这个产物暂时无法在Canvas中打开。');
    }
    return jsonError(503, 'artifact_detail_unavailable', '暂时无法读取产物。');
  }
}

const mutateArtifactSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('generate'),
      baseVersion: z.number().int().min(1),
      instruction: z.string().trim().min(1).max(2_000),
    })
    .strict(),
  z
    .object({
      action: z.literal('save_note'),
      baseVersion: z.number().int().min(1),
      markdown: z.string().max(NOTE_MARKDOWN_MAX_CHARS),
    })
    .strict(),
]);

/**
 * Canvas 共创入口：AI 修改进入持久生成任务，笔记直接保存只追加不可变
 * 版本。两种动作使用显式判别字段，禁止用正文前缀推断调用意图。
 */
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
    body = await readLimitedJsonRequest(request);
  } catch (error) {
    if (error instanceof JsonRequestValidationError) {
      return jsonRequestErrorResponse(error);
    }
    throw error;
  }
  const parsed = mutateArtifactSchema.safeParse(body);
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
      (parsed.data.action === 'save_note'
        ? artifact.kind !== 'note'
        : !['mind_map', 'slides', 'flashcards', 'note'].includes(artifact.kind))
    ) {
      throw new ArtifactOwnershipError();
    }

    if (parsed.data.action === 'save_note') {
      const currentVersion = await repository.getVersion({
        artifactId,
        version: parsed.data.baseVersion,
        trustedSubjectId: identity.studentId,
      });
      const currentContent = noteContentSchema.parse(currentVersion.content);
      const version = await repository.appendVersion({
        artifactId,
        trustedSubjectId: identity.studentId,
        content: noteContentSchema.parse({
          ...currentContent,
          markdown: parsed.data.markdown,
          generatedByModel: false,
        }),
        generatedBy: 'user:manual',
        expectedLatestVersion: parsed.data.baseVersion,
      });
      return Response.json(
        {
          artifact: {
            id: artifact.id,
            kind: artifact.kind,
            trustTier: artifact.trustTier,
            title: artifact.title,
            status: artifact.status,
            latestVersion: version.version,
          },
          job: null,
        },
        { status: 200 },
      );
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
