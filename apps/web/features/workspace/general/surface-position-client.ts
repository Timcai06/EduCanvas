'use client';

import { canvasResourceKindSchema } from '@educanvas/canvas-protocol';
import { z } from 'zod';

export const surfacePositionSchema = z
  .object({
    resourceKind: canvasResourceKindSchema,
    resourceId: z.string().uuid(),
    zone: z.enum(['center', 'periphery', 'margin']),
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    z: z.number().int().min(0).max(100),
    restState: z.enum(['open', 'folded', 'pinned']),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export type SurfacePosition = z.infer<typeof surfacePositionSchema>;
export type SaveSurfacePosition = Omit<SurfacePosition, 'updatedAt'>;

const listSchema = z
  .object({ positions: z.array(surfacePositionSchema).max(256) })
  .strict();
const saveSchema = z.object({ position: surfacePositionSchema }).strict();

export async function fetchSurfacePositions(
  signal?: AbortSignal,
): Promise<readonly SurfacePosition[]> {
  const response = await fetch('/api/v1/canvas/surface-layout', {
    credentials: 'same-origin',
    cache: 'no-store',
    signal,
  });
  if (!response.ok) throw new Error('surface_layout_load_failed');
  const parsed = listSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error('surface_layout_response_invalid');
  return parsed.data.positions;
}

export async function saveSurfacePosition(
  position: SaveSurfacePosition,
): Promise<SurfacePosition> {
  const response = await fetch('/api/v1/canvas/surface-layout', {
    method: 'PUT',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(position),
  });
  if (!response.ok) throw new Error('surface_layout_save_failed');
  const parsed = saveSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error('surface_layout_response_invalid');
  return parsed.data.position;
}
