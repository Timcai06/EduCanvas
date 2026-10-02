import 'server-only';
import { createHash } from 'node:crypto';
import type { TemporalIdCursor } from '@educanvas/db';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type ResourceFilter = 'all' | 'source' | 'artifact';
export type WebDataOwnerKind = 'local' | 'registered' | 'anonymous';
export interface WorkspaceResourceSummaryCursor {
  readonly source: TemporalIdCursor | null;
  readonly artifact: TemporalIdCursor | null;
}
export class WorkspaceResourceReadModelError extends Error {
  constructor(readonly code: 'invalid_cursor' | 'resource_not_found') {
    super(code);
    this.name = 'WorkspaceResourceReadModelError';
  }
}

/** CA07 数据主体进入缓存边界时只保留隔离命名空间与受控摘要。 */
export function buildWorkspaceResourceCacheKey(input: {
  readonly dataOwnerKind: WebDataOwnerKind;
  readonly dataOwnerId: string;
  readonly notebookId: string;
  readonly cursor: string | null;
  readonly filter: ResourceFilter;
}): string {
  const ownerDigest = createHash('sha256')
    .update(input.dataOwnerId, 'utf8')
    .digest('hex');
  const queryDigest = createHash('sha256')
    .update(
      JSON.stringify({
        cursor: input.cursor,
        filter: input.filter,
        sort: 'updated_at_desc_kind_id_v1',
      }),
      'utf8',
    )
    .digest('hex');
  return [
    'workspace-resource-summary-v1',
    'web',
    input.dataOwnerKind,
    ownerDigest,
    input.notebookId,
    queryDigest,
  ].join(':');
}

function cursorPart(value: unknown): TemporalIdCursor | null {
  if (value === null) return null;
  if (
    typeof value !== 'object' ||
    !value ||
    !('t' in value) ||
    typeof value.t !== 'string' ||
    !('id' in value) ||
    typeof value.id !== 'string' ||
    !UUID.test(value.id)
  ) {
    throw new WorkspaceResourceReadModelError('invalid_cursor');
  }
  const timestamp = new Date(value.t);
  if (!Number.isFinite(timestamp.getTime())) {
    throw new WorkspaceResourceReadModelError('invalid_cursor');
  }
  return { timestamp, id: value.id };
}

export function decodeCursor(
  value: string | null,
): WorkspaceResourceSummaryCursor {
  if (!value) return { source: null, artifact: null };
  try {
    const decoded = JSON.parse(
      Buffer.from(value, 'base64url').toString('utf8'),
    ) as unknown;
    if (
      typeof decoded !== 'object' ||
      !decoded ||
      !('v' in decoded) ||
      decoded.v !== 1 ||
      !('source' in decoded) ||
      !('artifact' in decoded) ||
      Object.keys(decoded).some(
        (key) => !['v', 'source', 'artifact'].includes(key),
      )
    ) {
      throw new WorkspaceResourceReadModelError('invalid_cursor');
    }
    return {
      source: cursorPart(decoded.source),
      artifact: cursorPart(decoded.artifact),
    };
  } catch (error) {
    if (error instanceof WorkspaceResourceReadModelError) throw error;
    throw new WorkspaceResourceReadModelError('invalid_cursor');
  }
}

export function encodeCursor(cursor: WorkspaceResourceSummaryCursor): string {
  const serialize = (value: TemporalIdCursor | null) =>
    value ? { t: value.timestamp.toISOString(), id: value.id } : null;
  return Buffer.from(
    JSON.stringify({
      v: 1,
      source: serialize(cursor.source),
      artifact: serialize(cursor.artifact),
    }),
    'utf8',
  ).toString('base64url');
}
