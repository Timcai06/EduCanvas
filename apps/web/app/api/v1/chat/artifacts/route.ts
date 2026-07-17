import { readAnonymousIdentity } from '@/server/anonymous-identity';
import { loadOwnedGeneralConversation } from '@/server/general-conversation';
import { jsonError } from '@/server/request-security';
import { DrizzlePlatformArtifactRepository } from '@educanvas/db';

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
