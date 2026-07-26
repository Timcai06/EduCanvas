import { readAnonymousIdentity } from '@/server/identity/anonymous-identity';
import { jsonError } from '@/server/http/request-security';
import { loadOwnedGeneralConversation } from '@/server/platform/general-conversation';
import {
  CanvasResourceAccessError,
  loadOwnedCanvasResource,
} from '@/server/canvas/resource-access';
import { canvasResourceKindSchema } from '@educanvas/canvas-protocol';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const paramsSchema = z
  .object({
    resourceKind: canvasResourceKindSchema,
    resourceId: z.string().uuid(),
  })
  .strict();

/** 只读统一资源描述；内容继续由既有Source/Artifact详情端点按次鉴权读取。 */
export async function GET(
  _request: Request,
  context: {
    params: Promise<{ resourceKind: string; resourceId: string }>;
  },
): Promise<Response> {
  const parsed = paramsSchema.safeParse(await context.params);
  if (!parsed.success) {
    return jsonError(404, 'resource_not_found', '资源不存在。');
  }
  const identity = await readAnonymousIdentity();
  if (!identity) return jsonError(401, 'unauthorized', '请先开始对话。');
  const conversation = await loadOwnedGeneralConversation(identity);
  if (!conversation) return jsonError(401, 'unauthorized', '请先开始对话。');

  try {
    const resource = await loadOwnedCanvasResource({
      identity,
      notebookId: conversation.spaceId,
      resourceKind: parsed.data.resourceKind,
      resourceId: parsed.data.resourceId,
    });
    return Response.json({ resource });
  } catch (error) {
    if (error instanceof CanvasResourceAccessError) {
      return jsonError(
        error.status,
        error.code,
        error.status === 404 ? '资源不存在。' : '这个资源暂时无法打开。',
      );
    }
    return jsonError(503, 'resource_unavailable', '资源读取暂时不可用。');
  }
}
