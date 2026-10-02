'use client';

import {
  notebookScopedFetch,
  type NotebookRequestContext,
} from '@/features/workspace/general/notebook-request-context';

import {
  canvasAnnotationSchema,
  type CanvasAnnotation,
  type CanvasResourceKind,
  type CreateCanvasAnnotation,
} from '@educanvas/canvas-protocol';
import { z } from 'zod';

const listResponseSchema = z
  .object({ annotations: z.array(canvasAnnotationSchema) })
  .strict();
const createResponseSchema = z
  .object({ annotation: canvasAnnotationSchema })
  .strict();

function endpoint(resourceKind: CanvasResourceKind, resourceId: string) {
  return `/api/v1/canvas/resources/${resourceKind}/${resourceId}/annotations`;
}

export async function fetchResourceAnnotations(input: {
  requestContext?: NotebookRequestContext | null;
  resourceKind: CanvasResourceKind;
  resourceId: string;
  signal?: AbortSignal;
}): Promise<readonly CanvasAnnotation[]> {
  const response = await notebookScopedFetch(
    endpoint(input.resourceKind, input.resourceId),
    {
      credentials: 'same-origin',
      cache: 'no-store',
      signal: input.signal,
    },
    input.requestContext,
  );
  if (!response.ok) throw new Error('annotation_list_failed');
  const parsed = listResponseSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error('annotation_response_invalid');
  return parsed.data.annotations;
}

export async function saveResourceAnnotation(input: {
  requestContext?: NotebookRequestContext | null;
  resourceKind: CanvasResourceKind;
  resourceId: string;
  annotation: CreateCanvasAnnotation;
}): Promise<CanvasAnnotation> {
  const response = await notebookScopedFetch(
    endpoint(input.resourceKind, input.resourceId),
    {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input.annotation),
    },
    input.requestContext,
  );
  if (!response.ok) throw new Error('annotation_create_failed');
  const parsed = createResponseSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error('annotation_response_invalid');
  return parsed.data.annotation;
}
