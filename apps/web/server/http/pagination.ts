import 'server-only';

import type { TemporalIdCursor } from '@educanvas/db';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class PaginationRequestError extends Error {
  readonly code = 'invalid_pagination';

  constructor() {
    super('invalid_pagination');
    this.name = 'PaginationRequestError';
  }
}

export function encodeTemporalCursor(
  cursor: TemporalIdCursor | null,
): string | null {
  if (!cursor) return null;
  return Buffer.from(
    JSON.stringify({
      v: 1,
      t: cursor.timestamp.toISOString(),
      id: cursor.id,
    }),
    'utf8',
  ).toString('base64url');
}

function decodeTemporalCursor(value: string): TemporalIdCursor {
  try {
    const decoded = JSON.parse(
      Buffer.from(value, 'base64url').toString('utf8'),
    ) as unknown;
    if (
      typeof decoded !== 'object' ||
      decoded === null ||
      !('v' in decoded) ||
      decoded.v !== 1 ||
      !('t' in decoded) ||
      typeof decoded.t !== 'string' ||
      !('id' in decoded) ||
      typeof decoded.id !== 'string' ||
      !UUID_PATTERN.test(decoded.id)
    ) {
      throw new PaginationRequestError();
    }
    const timestamp = new Date(decoded.t);
    if (!Number.isFinite(timestamp.getTime())) {
      throw new PaginationRequestError();
    }
    return { timestamp, id: decoded.id };
  } catch (error) {
    if (error instanceof PaginationRequestError) throw error;
    throw new PaginationRequestError();
  }
}

export function parseListPagination(
  request: Request | undefined,
  defaultLimit = 50,
): { limit: number; cursor: TemporalIdCursor | null } {
  if (!request) return { limit: defaultLimit, cursor: null };
  const params = new URL(request.url).searchParams;
  const rawLimit = params.get('limit');
  const limit = rawLimit === null ? defaultLimit : Number(rawLimit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new PaginationRequestError();
  }
  const rawCursor = params.get('cursor');
  return {
    limit,
    cursor: rawCursor === null ? null : decodeTemporalCursor(rawCursor),
  };
}
