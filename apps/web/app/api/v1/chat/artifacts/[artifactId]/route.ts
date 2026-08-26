import { readAnonymousIdentity } from '@/server/identity/anonymous-identity';
import { loadOwnedGeneralConversation } from '@/server/platform/general-conversation';
import {
  isTrustedSameOriginWrite,
  jsonError,
  jsonResponse,
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
  requireNotebookAccess,
} from '@educanvas/db';
import { getDb } from '@educanvas/db/internal';
import {
  MARKDOWN_DOCUMENT_MAX_CHARS,
  markdownDocumentContentSchema,
  mindMapContentSchema,
  NOTE_MARKDOWN_MAX_CHARS,
  noteContentSchema,
} from '@educanvas/canvas-protocol';
import { PicturebookBundleError } from '@/server/canvas/picturebook-bundle';
import { projectArtifactVersionForBrowser } from '@/server/canvas/artifact-version-projection';
import { webAppContentSchema } from '@educanvas/canvas-protocol/server';
import {
  ArtifactResourceProjectionError,
  projectOwnedArtifactResource,
} from '@/server/canvas/artifact-resource-adapter';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 产物详情不返回 objectKey/checksum，越权与不存在同错（404）。 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ artifactId: string }> },
): Promise<Response> {
  const { artifactId } = await params;
  if (!UUID_PATTERN.test(artifactId)) {
    return jsonError(404, 'artifact_not_found');
  }
  const identity = await readAnonymousIdentity();
  if (!identity) return jsonError(401, 'unauthorized');
  const conversation = await loadOwnedGeneralConversation(identity);
  if (!conversation) return jsonError(401, 'unauthorized');

  try {
    const repository = new DrizzlePlatformArtifactRepository();
    const detail = await repository.getArtifactDetail({
      artifactId,
      trustedSubjectId: identity.studentId,
    });
    if (detail.artifact.spaceId !== conversation.spaceId) {
      throw new ArtifactOwnershipError();
    }
    if (detail.artifact.status === 'archived') {
      return jsonError(404, 'artifact_not_found');
    }
    const access = await requireNotebookAccess(getDb(), {
      notebookId: conversation.spaceId,
      trustedSubjectId: identity.studentId,
      requiredPermission: 'notebook.read',
    }).catch(() => null);
    if (!access) throw new ArtifactOwnershipError();
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
    const versionProvenanceJob = selectedVersion?.generationJobId
      ? await repository.getGenerationJob({
          jobId: selectedVersion.generationJobId,
          trustedSubjectId: identity.studentId,
        })
      : null;
    const versions = await repository.listVersionProvenance({
      artifactId,
      trustedSubjectId: identity.studentId,
    });
    /* 首版前只返回 latestJob；没有不可变版本就不构造 CanvasResource。 */
    const canvasResource = selectedVersion
      ? projectOwnedArtifactResource({
          notebookId: conversation.spaceId,
          artifact: detail.artifact,
          version: selectedVersion,
          latestJob: detail.latestJob,
          versionJob: versionProvenanceJob,
          accessRole: access.role,
        })
      : null;
    const canDownload =
      canvasResource?.allowedActions.includes('download') ?? false;
    const projectedVersion = selectedVersion
      ? await projectArtifactVersionForBrowser({
          artifactId,
          kind: detail.artifact.kind,
          version: selectedVersion,
          canDownload,
        })
      : null;
    return jsonResponse({
      artifact: {
        id: detail.artifact.id,
        kind: detail.artifact.kind,
        trustTier: detail.artifact.trustTier,
        title: detail.artifact.title,
        status: detail.artifact.status,
        latestVersion: detail.artifact.latestVersion,
        createdAt: detail.artifact.createdAt,
        updatedAt: detail.artifact.updatedAt,
        /* 只公开可信来源标记，不泄露 conversationId。 */
        fromConversation: detail.artifact.conversationId !== null,
      },
      version: selectedVersion
        ? {
            id: selectedVersion.id,
            version: selectedVersion.version,
            content: projectedVersion!.content,
            media: projectedVersion!.media,
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
      ...(canvasResource ? { canvasResource } : {}),
    });
  } catch (error) {
    if (error instanceof ArtifactOwnershipError) {
      return jsonError(404, 'artifact_not_found');
    }
    if (error instanceof ArtifactResourceProjectionError) {
      const status = error.code === 'resource_not_found' ? 404 : error.status;
      return jsonError(status, error.code);
    }
    if (error instanceof PicturebookBundleError) {
      return jsonError(422, 'resource_invalid');
    }
    return jsonError(503, 'artifact_detail_unavailable');
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
  z
    .object({
      action: z.literal('save_markdown_document'),
      baseVersion: z.number().int().min(1),
      markdown: z.string().max(MARKDOWN_DOCUMENT_MAX_CHARS),
    })
    .strict(),
  z
    .object({
      action: z.literal('restore'),
      sourceVersion: z.number().int().min(1),
      expectedLatestVersion: z.number().int().min(1),
    })
    .strict(),
]);

function validateRestorableContent(kind: string, content: unknown): unknown {
  if (kind === 'markdown_document') {
    return markdownDocumentContentSchema.parse(content);
  }
  if (kind === 'mind_map') return mindMapContentSchema.parse(content);
  if (kind === 'web_app') return webAppContentSchema.parse(content);
  throw new ArtifactOwnershipError();
}

function supportsMutation(
  kind: string,
  action: z.infer<typeof mutateArtifactSchema>['action'],
): boolean {
  if (action === 'save_note') return kind === 'note';
  if (action === 'save_markdown_document') {
    return kind === 'markdown_document';
  }
  if (action === 'restore') {
    return ['mind_map', 'markdown_document', 'web_app'].includes(kind);
  }
  return [
    'mind_map',
    'slides',
    'flashcards',
    'note',
    'markdown_document',
    'web_app',
  ].includes(kind);
}

/** Canvas 共创按显式动作区分持久生成任务与不可变笔记版本。 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ artifactId: string }> },
): Promise<Response> {
  if (!isTrustedSameOriginWrite(request)) {
    return jsonError(403, 'forbidden_origin');
  }
  const { artifactId } = await params;
  if (!UUID_PATTERN.test(artifactId)) {
    return jsonError(404, 'artifact_not_found');
  }
  const identity = await readAnonymousIdentity();
  if (!identity) return jsonError(401, 'unauthorized');
  const conversation = await loadOwnedGeneralConversation(identity);
  if (!conversation) return jsonError(401, 'unauthorized');

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
    return jsonError(400, 'invalid_request');
  }

  try {
    const repository = new DrizzlePlatformArtifactRepository();
    const artifact = await repository.getArtifact({
      artifactId,
      trustedSubjectId: identity.studentId,
    });
    if (
      artifact.spaceId !== conversation.spaceId ||
      !supportsMutation(artifact.kind, parsed.data.action)
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
      return jsonResponse(
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

    if (parsed.data.action === 'save_markdown_document') {
      const currentVersion = await repository.getVersion({
        artifactId,
        version: parsed.data.baseVersion,
        trustedSubjectId: identity.studentId,
      });
      const currentContent = markdownDocumentContentSchema.parse(
        currentVersion.content,
      );
      const version = await repository.appendVersion({
        artifactId,
        trustedSubjectId: identity.studentId,
        content: markdownDocumentContentSchema.parse({
          ...currentContent,
          markdown: parsed.data.markdown,
          generatedByModel: false,
        }),
        generatedBy: 'user:manual',
        expectedLatestVersion: parsed.data.baseVersion,
      });
      return jsonResponse(
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

    if (parsed.data.action === 'restore') {
      const source = await repository.getVersion({
        artifactId,
        version: parsed.data.sourceVersion,
        trustedSubjectId: identity.studentId,
      });
      const version = await repository.appendVersion({
        artifactId,
        trustedSubjectId: identity.studentId,
        content: validateRestorableContent(artifact.kind, source.content),
        generatedBy: `user:restore:v${source.version}`,
        expectedLatestVersion: parsed.data.expectedLatestVersion,
      });
      return jsonResponse({
        artifact: {
          id: artifact.id,
          kind: artifact.kind,
          trustTier: artifact.trustTier,
          title: artifact.title,
          status: artifact.status,
          latestVersion: version.version,
        },
        job: null,
      });
    }

    const created = await repository.createRevisionGenerationJob({
      artifactId,
      conversationId: conversation.id,
      trustedSubjectId: identity.studentId,
      baseVersion: parsed.data.baseVersion,
      instruction: parsed.data.instruction,
      taskIdentifier: ARTIFACT_GENERATE_TASK,
    });
    return jsonResponse(
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
      return jsonError(409, error.code);
    }
    if (error instanceof ArtifactOwnershipError) {
      return jsonError(404, 'artifact_not_found');
    }
    return jsonError(503, 'artifact_revision_unavailable');
  }
}

/**
 * 授权删除：同源校验 → 身份 → Notebook.write → 归档 + 删除意图。
 * viewer 无权删除；服务端不信任浏览器提交的 allowedActions。
 * 删除后所有读取面立即拒绝，后台物理删除通过 durable outbox 完成。
 * 重复删除幂等返回不可见状态。
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ artifactId: string }> },
): Promise<Response> {
  if (!isTrustedSameOriginWrite(request)) {
    return jsonError(403, 'forbidden_origin');
  }
  const { artifactId } = await params;
  if (!UUID_PATTERN.test(artifactId)) {
    return jsonError(404, 'artifact_not_found');
  }
  const identity = await readAnonymousIdentity();
  if (!identity) return jsonError(401, 'unauthorized');
  const conversation = await loadOwnedGeneralConversation(identity);
  if (!conversation) return jsonError(401, 'unauthorized');

  try {
    const repository = new DrizzlePlatformArtifactRepository();
    const archived = await repository.archiveOwnedArtifact({
      artifactId,
      trustedSubjectId: identity.studentId,
      notebookId: conversation.spaceId,
    });
    if (!archived) {
      return jsonError(404, 'artifact_not_found');
    }
    return jsonResponse({ deleted: true }, { status: 200 });
  } catch (error) {
    if (error instanceof ArtifactOwnershipError) {
      return jsonError(404, 'artifact_not_found');
    }
    return jsonError(503, 'artifact_delete_unavailable');
  }
}
