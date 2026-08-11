import { readAnonymousIdentity } from '@/server/identity/anonymous-identity';
import { loadOwnedGeneralConversation } from '@/server/platform/general-conversation';
import {
  isTrustedSameOriginWrite,
  jsonError,
  jsonResponse,
} from '@/server/http/request-security';
import { CanvasResourceAccessError } from '@/server/canvas/resource-access';
import { removeOwnedResourceAnnotation } from '@/server/canvas/resource-annotations';
import { canvasResourceKindSchema } from '@educanvas/canvas-protocol';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const paramsSchema = z
  .object({
    resourceKind: canvasResourceKindSchema,
    resourceId: z.string().uuid(),
    annotationId: z.string().uuid(),
  })
  .strict();

export async function DELETE(
  request: Request,
  context: {
    params: Promise<{
      resourceKind: string;
      resourceId: string;
      annotationId: string;
    }>;
  },
): Promise<Response> {
  if (!isTrustedSameOriginWrite(request)) {
    return jsonError(403, 'forbidden_origin', '请求来源不受信任。');
  }
  const params = paramsSchema.safeParse(await context.params);
  if (!params.success) {
    return jsonError(404, 'annotation_not_found', '批注不存在。');
  }
  const identity = await readAnonymousIdentity();
  if (!identity) return jsonError(401, 'unauthorized', '请先开始对话。');
  const conversation = await loadOwnedGeneralConversation(identity);
  if (!conversation) return jsonError(401, 'unauthorized', '请先开始对话。');
  try {
    const removed = await removeOwnedResourceAnnotation({
      identity,
      notebookId: conversation.spaceId,
      ...params.data,
    });
    if (!removed) {
      return jsonError(404, 'annotation_not_found', '批注不存在。');
    }
    return jsonResponse({ removed: true });
  } catch (error) {
    if (error instanceof CanvasResourceAccessError) {
      return jsonError(404, 'annotation_not_found', '批注不存在。');
    }
    return jsonError(503, 'annotation_unavailable', '批注暂时不可用。');
  }
}
