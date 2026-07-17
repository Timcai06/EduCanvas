import { readAnonymousIdentity } from '@/server/identity/anonymous-identity';
import { loadOwnedGeneralConversation } from '@/server/platform/general-conversation';
import {
  isTrustedSameOriginWrite,
  jsonError,
} from '@/server/http/request-security';
import {
  ARTIFACT_GENERATE_TASK,
  DrizzlePlatformArtifactRepository,
} from '@educanvas/db';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 断连恢复读取面(ADR-0012):SSE 只负责实时增量,产物的权威状态永远可以
 * 从本端点重建,浏览器刷新/断连后不依赖流的连续性。
 * 只返回公开投影字段,不包含版本内容与生成参数——那些按需经产物详情获取。
 */
export async function GET(): Promise<Response> {
  const identity = await readAnonymousIdentity();
  if (!identity) return jsonError(401, 'unauthorized', '请先开始对话。');
  const conversation = await loadOwnedGeneralConversation(identity);
  if (!conversation) return jsonError(401, 'unauthorized', '请先开始对话。');

  try {
    const repository = new DrizzlePlatformArtifactRepository();
    const artifacts = await repository.listConversationArtifacts({
      conversationId: conversation.id,
      trustedSubjectId: identity.studentId,
    });
    return Response.json({
      artifacts: artifacts.map((artifact) => ({
        id: artifact.id,
        kind: artifact.kind,
        trustTier: artifact.trustTier,
        title: artifact.title,
        status: artifact.status,
        latestVersion: artifact.latestVersion,
        updatedAt: artifact.updatedAt,
      })),
    });
  } catch {
    return jsonError(503, 'artifact_list_unavailable', '暂时无法读取产物。');
  }
}

/** 首个开放的产物类型;M2 扩展 slides/quiz 时改为 Registry 提供。 */
const createArtifactSchema = z
  .object({
    kind: z.literal('mind_map'),
    title: z.string().trim().min(1).max(120),
  })
  .strict();

/**
 * 产物提议 + 用户确认后的创建入口:产物行、任务账本与队列行同事务原子提交
 * (ADR-0012)。生成进度经 GET 列表/详情轮询获取;worker 未启动过的环境会
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
  try {
    body = await request.json();
  } catch {
    return jsonError(400, 'invalid_request', '请求格式不正确。');
  }
  const parsed = createArtifactSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, 'invalid_request', '产物参数不正确。');
  }

  try {
    const repository = new DrizzlePlatformArtifactRepository();
    const created = await repository.createArtifactWithGenerationJob({
      spaceId: conversation.spaceId,
      conversationId: conversation.id,
      trustedSubjectId: identity.studentId,
      kind: parsed.data.kind,
      trustTier: 'tier1',
      title: parsed.data.title,
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
      { status: 201 },
    );
  } catch {
    return jsonError(503, 'artifact_create_unavailable', '暂时无法创建产物。');
  }
}
