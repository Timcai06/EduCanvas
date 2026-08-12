import { readAnonymousIdentity } from '@/server/identity/anonymous-identity';
import { loadOwnedGeneralConversation } from '@/server/platform/general-conversation';
import {
  isTrustedSameOriginWrite,
  jsonError,
  jsonResponse,
} from '@/server/http/request-security';
import {
  encodeTemporalCursor,
  PaginationRequestError,
  parseListPagination,
} from '@/server/http/pagination';
import {
  JsonRequestValidationError,
  jsonRequestErrorResponse,
  readIdempotencyKey,
  readLimitedJsonRequest,
} from '@/server/http/json-request';
import {
  AssetAccessError,
  ArtifactIdempotencyConflictError,
  ARTIFACT_GENERATE_TASK,
  DrizzleAssetRepository,
  DrizzleManualArtifactRepository,
  DrizzlePlatformArtifactRepository,
} from '@educanvas/db';
import { assetVersionReferenceSchema } from '@educanvas/agent-core';
import {
  NOTE_MARKDOWN_MAX_CHARS,
  noteContentSchema,
} from '@educanvas/canvas-protocol';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// K12 桥接类型已有平台身份，但在 Web Renderer Registry 迁移前不进入 Studio 列表。
const WEB_ARTIFACT_KINDS = [
  'mind_map',
  'slides',
  'flashcards',
  'markdown_document',
  'note',
  'audio_overview',
  'generated_image',
  'dom_exploration',
  'web_app',
] as const;

/**
 * 断连恢复读取面(ADR-0005):SSE 只负责实时增量,产物的权威状态永远可以
 * 从本端点重建,浏览器刷新/断连后不依赖流的连续性。
 * 只返回公开投影字段,不包含版本内容与生成参数——那些按需经产物详情获取。
 */
export async function GET(request: Request): Promise<Response> {
  const identity = await readAnonymousIdentity();
  if (!identity) return jsonError(401, 'unauthorized', '请先开始对话。');
  const conversation = await loadOwnedGeneralConversation(identity);
  if (!conversation) return jsonError(401, 'unauthorized', '请先开始对话。');

  try {
    const pagination = parseListPagination(request);
    const repository = new DrizzlePlatformArtifactRepository();
    const page = await repository.listSpaceArtifactsPage({
      spaceId: conversation.spaceId,
      trustedSubjectId: identity.studentId,
      kinds: WEB_ARTIFACT_KINDS,
      ...pagination,
    });
    return jsonResponse({
      artifacts: page.items.map((artifact) => ({
        id: artifact.id,
        kind: artifact.kind,
        trustTier: artifact.trustTier,
        title: artifact.title,
        status: artifact.status,
        latestVersion: artifact.latestVersion,
        updatedAt: artifact.updatedAt,
      })),
      page: { nextCursor: encodeTemporalCursor(page.nextCursor) },
    });
  } catch (error) {
    if (error instanceof PaginationRequestError) {
      return jsonError(400, error.code, '分页参数不正确。');
    }
    return jsonError(503, 'artifact_list_unavailable', '暂时无法读取产物。');
  }
}

/** 已开放的产物类型;quiz 泛化后加入,更长期由 Registry 提供。 */
const titleSchema = z.string().trim().min(1).max(120);
const createArtifactSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.enum(['mind_map', 'slides', 'flashcards']),
      title: titleSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('markdown_document'),
      title: titleSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('note'),
      title: titleSchema,
      markdown: z.string().max(NOTE_MARKDOWN_MAX_CHARS).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('web_app'),
      title: titleSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('audio_overview'),
      title: titleSchema,
      sources: z.array(assetVersionReferenceSchema).min(1).max(8),
    })
    .strict(),
]);

/**
 * 产物提议 + 用户确认后的创建入口:产物行、任务账本与队列行同事务原子提交
 * (ADR-0005)。生成进度经 GET 列表/详情轮询获取;worker 未启动过的环境会
 * 诚实失败,不静默降级为同步生成。
 */
export async function POST(request: Request): Promise<Response> {
  if (!isTrustedSameOriginWrite(request)) {
    return jsonError(403, 'forbidden_origin', '请求来源不受信任。');
  }
  const identity = await readAnonymousIdentity();
  if (!identity) return jsonError(401, 'unauthorized', '请先开始对话。');
  const conversation = await loadOwnedGeneralConversation(identity);
  if (!conversation) return jsonError(401, 'unauthorized', '请先开始对话。');

  let body: unknown;
  let idempotencyKey: string | null;
  try {
    idempotencyKey = readIdempotencyKey(request);
    body = await readLimitedJsonRequest(request);
  } catch (error) {
    if (error instanceof JsonRequestValidationError) {
      return jsonRequestErrorResponse(error);
    }
    throw error;
  }
  const parsed = createArtifactSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, 'invalid_request', '产物参数不正确。');
  }
  const requestFingerprint = idempotencyKey
    ? createHash('sha256')
        .update(JSON.stringify(parsed.data), 'utf8')
        .digest('hex')
    : null;

  try {
    let params: Record<string, unknown> = {};
    if (parsed.data.kind === 'audio_overview') {
      let materialized;
      try {
        materialized =
          await new DrizzleAssetRepository().materializeOwnedReferences({
            ownerSubjectId: identity.studentId,
            spaceId: conversation.spaceId,
            references: parsed.data.sources,
          });
      } catch (error) {
        if (error instanceof AssetAccessError) {
          return jsonError(
            400,
            'audio_sources_unavailable',
            '部分来源已不可用，请重新选择。',
          );
        }
        throw error;
      }
      if (
        materialized.some(
          (source) =>
            !['document', 'link'].includes(source.reference.kind) ||
            !source.extractedText?.trim(),
        )
      ) {
        return jsonError(
          400,
          'audio_source_not_supported',
          '音频概览目前只支持已解析的 PDF 或网页来源。',
        );
      }
      params = { selectedSources: parsed.data.sources };
    }

    /* 用户直接新建空白笔记时，Artifact 与 v1 在同一事务落库，不产生
       generation job；缺少 markdown 则仍按普通生成请求进入 Worker。 */
    if (parsed.data.kind === 'note' && parsed.data.markdown !== undefined) {
      const created =
        await new DrizzleManualArtifactRepository().createWithInitialVersion({
          spaceId: conversation.spaceId,
          conversationId: conversation.id,
          trustedSubjectId: identity.studentId,
          kind: 'note',
          trustTier: 'tier1',
          title: parsed.data.title,
          content: noteContentSchema.parse({
            contentVersion: 1,
            markdown: parsed.data.markdown,
            sourceConversationId: conversation.id,
            generatedByModel: false,
          }),
          generatedBy: 'user:manual',
          idempotencyKey,
          requestFingerprint,
        });
      return jsonResponse(
        {
          artifact: {
            id: created.artifact.id,
            kind: created.artifact.kind,
            trustTier: created.artifact.trustTier,
            title: created.artifact.title,
            status: 'active',
            latestVersion: 1,
          },
          job: null,
          replayed: created.replayed,
        },
        { status: created.replayed ? 200 : 201 },
      );
    }

    const repository = new DrizzlePlatformArtifactRepository();
    const created = await repository.createArtifactWithGenerationJob({
      spaceId: conversation.spaceId,
      conversationId: conversation.id,
      trustedSubjectId: identity.studentId,
      kind: parsed.data.kind,
      trustTier:
        parsed.data.kind === 'audio_overview' || parsed.data.kind === 'web_app'
          ? 'tier2'
          : 'tier1',
      title: parsed.data.title,
      taskIdentifier: ARTIFACT_GENERATE_TASK,
      params,
      idempotencyKey,
      requestFingerprint,
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
        replayed: created.replayed,
      },
      { status: created.replayed ? 200 : 201 },
    );
  } catch (error) {
    if (error instanceof ArtifactIdempotencyConflictError) {
      return jsonError(
        409,
        'idempotency_conflict',
        '这个幂等键已用于不同的产物请求。',
      );
    }
    return jsonError(503, 'artifact_create_unavailable', '暂时无法创建产物。');
  }
}
import { createHash } from 'node:crypto';
