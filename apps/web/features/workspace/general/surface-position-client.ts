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

export const SURFACE_POSITION_PAGE_LIMIT = 1_024 as const;
export const SURFACE_POSITION_TOTAL_LIMIT = 4_096 as const;

const positionsSchema = z
  .array(surfacePositionSchema)
  .max(SURFACE_POSITION_PAGE_LIMIT);
const legacyListSchema = z
  .object({
    // The deployed endpoint is an unpaged compatibility response. Keep it
    // bounded by the same aggregate cap instead of rejecting at the old 256.
    positions: z.array(surfacePositionSchema).max(SURFACE_POSITION_TOTAL_LIMIT),
  })
  .strict();
const pagedListSchema = z
  .object({
    positions: positionsSchema,
    page: z
      .object({ nextCursor: z.string().min(1).max(4_096).nullable() })
      .strict(),
  })
  .strict();
const saveSchema = z.object({ position: surfacePositionSchema }).strict();

export type SurfacePositionClientErrorCode =
  | 'surface_layout_load_failed'
  | 'surface_layout_save_failed'
  | 'surface_layout_response_invalid';

export class SurfacePositionClientError extends Error {
  override readonly name = 'SurfacePositionClientError';

  constructor(readonly code: SurfacePositionClientErrorCode) {
    super(code);
  }
}

export function parseSurfacePositionPage(value: unknown): {
  readonly positions: readonly SurfacePosition[];
  readonly nextCursor: string | null;
} {
  const paged = pagedListSchema.safeParse(value);
  if (paged.success) {
    return {
      positions: paged.data.positions,
      nextCursor: paged.data.page.nextCursor,
    };
  }
  const legacy = legacyListSchema.safeParse(value);
  if (legacy.success) {
    return { positions: legacy.data.positions, nextCursor: null };
  }
  throw new SurfacePositionClientError('surface_layout_response_invalid');
}

function surfaceLayoutUrl(cursor: string | null): string {
  if (cursor === null) return '/api/v1/canvas/surface-layout';
  const query = new URLSearchParams({ cursor });
  return `/api/v1/canvas/surface-layout?${query.toString()}`;
}

export async function fetchSurfacePositions(
  signal?: AbortSignal,
): Promise<readonly SurfacePosition[]> {
  const positions: SurfacePosition[] = [];
  const identities = new Set<string>();
  const visitedCursors = new Set<string>();
  let cursor: string | null = null;

  do {
    let response: Response;
    try {
      response = await fetch(surfaceLayoutUrl(cursor), {
        credentials: 'same-origin',
        cache: 'no-store',
        signal,
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new SurfacePositionClientError('surface_layout_load_failed');
    }
    if (!response.ok) {
      throw new SurfacePositionClientError('surface_layout_load_failed');
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new SurfacePositionClientError('surface_layout_response_invalid');
    }
    const page = parseSurfacePositionPage(body);
    for (const position of page.positions) {
      const identity = `${position.resourceKind}:${position.resourceId}`;
      if (identities.has(identity)) continue;
      identities.add(identity);
      positions.push(position);
      if (positions.length > SURFACE_POSITION_TOTAL_LIMIT) {
        throw new SurfacePositionClientError('surface_layout_response_invalid');
      }
    }

    cursor = page.nextCursor;
    if (cursor !== null) {
      if (visitedCursors.has(cursor)) {
        throw new SurfacePositionClientError('surface_layout_response_invalid');
      }
      visitedCursors.add(cursor);
    }
  } while (cursor !== null);

  return positions;
}

export async function saveSurfacePosition(
  position: SaveSurfacePosition,
): Promise<SurfacePosition> {
  let response: Response;
  try {
    response = await fetch('/api/v1/canvas/surface-layout', {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(position),
    });
  } catch {
    throw new SurfacePositionClientError('surface_layout_save_failed');
  }
  if (!response.ok) {
    throw new SurfacePositionClientError('surface_layout_save_failed');
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new SurfacePositionClientError('surface_layout_response_invalid');
  }
  const parsed = saveSchema.safeParse(body);
  if (!parsed.success) {
    throw new SurfacePositionClientError('surface_layout_response_invalid');
  }
  return parsed.data.position;
}
