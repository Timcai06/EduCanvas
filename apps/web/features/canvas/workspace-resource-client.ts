import {
  workspaceResourceSummarySchema,
  type WorkspaceResourceSummary,
} from '@educanvas/canvas-protocol';
import { z } from 'zod';

export type WorkspaceResourcePage = {
  items: readonly WorkspaceResourceSummary[];
  nextCursor: string | null;
};

const pageSchema = z
  .object({
    items: z.array(workspaceResourceSummarySchema).max(200),
    nextCursor: z.string().min(1).max(4096).nullable(),
  })
  .strict();

export function parseWorkspaceResourcePage(
  value: unknown,
): WorkspaceResourcePage {
  const result = pageSchema.safeParse(value);
  if (!result.success) throw new Error('资源摘要响应格式不兼容。');
  return result.data;
}

export async function fetchWorkspaceResourcePage(
  options: {
    cursor?: string;
    filter?: 'all' | 'source' | 'artifact';
    limit?: number;
    signal?: AbortSignal;
  } = {},
): Promise<WorkspaceResourcePage> {
  if (
    options.limit !== undefined &&
    (!Number.isInteger(options.limit) ||
      options.limit < 1 ||
      options.limit > 100)
  ) {
    throw new Error('资源分页大小不正确。');
  }
  const query = new URLSearchParams();
  if (options.cursor) query.set('cursor', options.cursor);
  if (options.filter && options.filter !== 'all')
    query.set('filter', options.filter);
  if (options.limit !== undefined) query.set('limit', String(options.limit));
  const suffix = query.toString();
  const response = await fetch(
    `/api/v1/canvas/resources${suffix ? `?${suffix}` : ''}`,
    {
      method: 'GET',
      cache: 'no-store',
      signal: options.signal,
    },
  );
  if (!response.ok) {
    throw new Error(
      response.status === 401 || response.status === 403
        ? '没有权限访问资源。'
        : '资源列表暂时不可用。',
    );
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error('服务器响应格式不正确。');
  }
  return parseWorkspaceResourcePage(body);
}
