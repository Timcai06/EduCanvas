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
  CanvasResourceAccessError,
  loadOwnedCanvasResource,
} from '@/server/canvas/resource-access';
import {
  DrizzleNotebookSurfacePositionRepository,
  NotebookSurfacePositionValidationError,
} from '@educanvas/db';
import { canvasResourceKindSchema } from '@educanvas/canvas-protocol';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const positionSchema = z
  .object({
    resourceKind: canvasResourceKindSchema,
    resourceId: z.string().uuid(),
    zone: z.enum(['center', 'periphery', 'margin']),
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    z: z.number().int().min(0).max(100),
    restState: z.enum(['open', 'folded', 'pinned']),
  })
  .strict();

async function identityAndNotebook() {
  const identity = await readAnonymousIdentity();
  if (!identity) return null;
  const conversation = await loadOwnedGeneralConversation(identity);
  if (!conversation) return null;
  return { identity, notebookId: conversation.spaceId };
}

function projectPosition(
  row: Awaited<ReturnType<DrizzleNotebookSurfacePositionRepository['save']>>,
) {
  return {
    resourceKind: row.resourceKind,
    resourceId: row.resourceId,
    zone: row.zone,
    x: row.x,
    y: row.y,
    z: row.z,
    restState: row.restState,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function GET(): Promise<Response> {
  const resolved = await identityAndNotebook();
  if (!resolved) return jsonError(401, 'unauthorized', '请先开始对话。');
  try {
    const rows = await new DrizzleNotebookSurfacePositionRepository().list({
      spaceId: resolved.notebookId,
      ownerSubjectId: resolved.identity.studentId,
    });
    return jsonResponse({ positions: rows.map(projectPosition) });
  } catch {
    return jsonError(503, 'surface_layout_unavailable', '案面布局暂时不可用。');
  }
}

export async function PUT(request: Request): Promise<Response> {
  if (!isTrustedSameOriginWrite(request)) {
    return jsonError(403, 'forbidden_origin', '请求来源不受信任。');
  }
  const resolved = await identityAndNotebook();
  if (!resolved) return jsonError(401, 'unauthorized', '请先开始对话。');
  try {
    const parsed = positionSchema.safeParse(
      await readLimitedJsonRequest(request, { maxBytes: 8 * 1024 }),
    );
    if (!parsed.success) {
      return jsonError(400, 'invalid_surface_layout', '案面布局格式不正确。');
    }
    await loadOwnedCanvasResource({
      ...resolved,
      resourceKind: parsed.data.resourceKind,
      resourceId: parsed.data.resourceId,
    });
    const row = await new DrizzleNotebookSurfacePositionRepository().save({
      spaceId: resolved.notebookId,
      ownerSubjectId: resolved.identity.studentId,
      ...parsed.data,
    });
    return jsonResponse({ position: projectPosition(row) });
  } catch (error) {
    if (error instanceof JsonRequestValidationError) {
      return jsonRequestErrorResponse(error);
    }
    if (error instanceof CanvasResourceAccessError) {
      return jsonError(404, 'resource_not_found', '资源不存在。');
    }
    if (error instanceof NotebookSurfacePositionValidationError) {
      return jsonError(400, 'invalid_surface_layout', '案面布局格式不正确。');
    }
    return jsonError(503, 'surface_layout_unavailable', '案面布局暂时不可用。');
  }
}
