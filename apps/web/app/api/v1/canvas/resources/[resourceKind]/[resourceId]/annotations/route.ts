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
import { CanvasResourceAccessError } from '@/server/canvas/resource-access';
import {
  createOwnedResourceAnnotation,
  listOwnedResourceAnnotations,
} from '@/server/canvas/resource-annotations';
import {
  canvasResourceKindSchema,
  createCanvasAnnotationSchema,
} from '@educanvas/canvas-protocol';
import { ResourceAnnotationValidationError } from '@educanvas/db';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const paramsSchema = z
  .object({
    resourceKind: canvasResourceKindSchema,
    resourceId: z.string().uuid(),
  })
  .strict();

async function resolveIdentity() {
  const identity = await readAnonymousIdentity();
  if (!identity) return null;
  const conversation = await loadOwnedGeneralConversation(identity);
  if (!conversation) return null;
  return { identity, notebookId: conversation.spaceId };
}

function accessError(error: unknown): Response {
  if (error instanceof CanvasResourceAccessError) {
    return jsonError(error.status, error.code);
  }
  return jsonError(503, 'annotation_unavailable');
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ resourceKind: string; resourceId: string }> },
): Promise<Response> {
  const params = paramsSchema.safeParse(await context.params);
  if (!params.success) {
    return jsonError(404, 'resource_not_found');
  }
  const resolved = await resolveIdentity();
  if (!resolved) return jsonError(401, 'unauthorized');
  try {
    return jsonResponse({
      annotations: await listOwnedResourceAnnotations({
        ...resolved,
        ...params.data,
      }),
    });
  } catch (error) {
    return accessError(error);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ resourceKind: string; resourceId: string }> },
): Promise<Response> {
  if (!isTrustedSameOriginWrite(request)) {
    return jsonError(403, 'forbidden_origin');
  }
  const params = paramsSchema.safeParse(await context.params);
  if (!params.success) {
    return jsonError(404, 'resource_not_found');
  }
  const resolved = await resolveIdentity();
  if (!resolved) return jsonError(401, 'unauthorized');
  try {
    const parsed = createCanvasAnnotationSchema.safeParse(
      await readLimitedJsonRequest(request, { maxBytes: 16 * 1024 }),
    );
    if (!parsed.success) {
      return jsonError(400, 'invalid_annotation');
    }
    const annotation = await createOwnedResourceAnnotation({
      ...resolved,
      ...params.data,
      annotation: parsed.data,
    });
    return jsonResponse({ annotation }, { status: 201 });
  } catch (error) {
    if (error instanceof JsonRequestValidationError) {
      return jsonRequestErrorResponse(error);
    }
    if (error instanceof ResourceAnnotationValidationError) {
      return jsonError(400, 'invalid_annotation');
    }
    return accessError(error);
  }
}
