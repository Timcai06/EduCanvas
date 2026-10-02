import {
  readLimitedJsonRequest,
  JsonRequestValidationError,
  jsonRequestErrorResponse,
} from '../http/json-request';
import 'server-only';
import {
  NotebookAccessNotFoundError,
  NotebookPlanConflictError,
  NotebookPlanInputError,
  NotebookPlanNotFoundError,
} from '@educanvas/db';
import { z, type ZodType } from 'zod';
import { readAnonymousIdentity } from '../identity/anonymous-identity';
import {
  isTrustedSameOriginWrite,
  jsonError,
  jsonResponse,
} from '../http/request-security';

export type NotebookPlanRouteContext = {
  params: Promise<{ notebookId: string; planId?: string }>;
};
function errorResponse(error: unknown) {
  if (
    error instanceof NotebookAccessNotFoundError ||
    error instanceof NotebookPlanNotFoundError
  )
    return jsonError(404, 'resource_not_found');
  if (error instanceof NotebookPlanInputError)
    return jsonError(400, 'invalid_notebook_plan');
  if (error instanceof NotebookPlanConflictError)
    return jsonError(409, 'notebook_plan_conflict');
  return jsonError(503, 'notebook_plan_unavailable');
}
export async function notebookPlanRead(
  context: NotebookPlanRouteContext,
  load: (notebookId: string, subjectId: string) => Promise<unknown>,
) {
  const identity = await readAnonymousIdentity();
  if (!identity) return jsonError(401, 'unauthorized');
  const { notebookId } = await context.params;
  if (!z.string().uuid().safeParse(notebookId).success)
    return jsonError(400, 'invalid_notebook_id');
  try {
    return jsonResponse(await load(notebookId, identity.studentId));
  } catch (error) {
    return errorResponse(error);
  }
}
export async function notebookPlanWrite<T>(
  request: Request,
  context: NotebookPlanRouteContext,
  schema: ZodType<T>,
  save: (
    notebookId: string,
    subjectId: string,
    input: T,
    planId?: string,
  ) => Promise<unknown>,
) {
  if (!isTrustedSameOriginWrite(request))
    return jsonError(403, 'forbidden_origin');
  const identity = await readAnonymousIdentity();
  if (!identity) return jsonError(401, 'unauthorized');
  const { notebookId, planId } = await context.params;
  if (
    !z.string().uuid().safeParse(notebookId).success ||
    (planId !== undefined && !z.string().uuid().safeParse(planId).success)
  )
    return jsonError(400, 'invalid_notebook_id');
  let body: unknown;
  try {
    body = await readLimitedJsonRequest(request, { maxBytes: 24_000 });
  } catch (error) {
    return error instanceof JsonRequestValidationError
      ? jsonRequestErrorResponse(error)
      : jsonError(400, 'invalid_notebook_plan');
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return jsonError(400, 'invalid_notebook_plan');
  try {
    return jsonResponse(
      await save(notebookId, identity.studentId, parsed.data, planId),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
