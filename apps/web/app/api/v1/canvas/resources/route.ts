import { jsonError, jsonResponse } from '@/server/http/request-security';
import { readEffectiveSubject } from '@/server/identity/effective-subject';
import {
  listWorkspaceResourceSummaries,
  WorkspaceResourceReadModelError,
} from '@/server/canvas/workspace-resource-read-model';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const subject = await readEffectiveSubject();
  // Resolve the owner exactly once; a missing owner is never treated as a public list.
  if (!subject.dataOwnerId || subject.dataOwnerKind === 'none')
    return jsonError(401, 'unauthorized', '无法解析资源归属。');
  const url = new URL(request.url);
  const filter = url.searchParams.get('filter');
  if (filter !== null && !['all', 'source', 'artifact'].includes(filter)) {
    return jsonError(400, 'invalid_request', '资源筛选条件不正确。');
  }
  const limitRaw = url.searchParams.get('limit');
  const limit = limitRaw === null ? undefined : Number(limitRaw);
  if (
    limit !== undefined &&
    (!Number.isInteger(limit) || limit < 1 || limit > 100)
  ) {
    return jsonError(400, 'invalid_request', '资源分页大小不正确。');
  }
  const cursor = url.searchParams.get('cursor');
  try {
    const page = await listWorkspaceResourceSummaries({
      dataOwnerKind: subject.dataOwnerKind,
      dataOwnerId: subject.dataOwnerId,
      cursor,
      filter: (filter ?? 'all') as 'all' | 'source' | 'artifact',
      limit,
    });
    return jsonResponse(page);
  } catch (error) {
    if (
      error instanceof WorkspaceResourceReadModelError &&
      error.code === 'invalid_cursor'
    ) {
      return jsonError(400, 'invalid_pagination', '资源分页游标不正确。');
    }
    if (
      error instanceof WorkspaceResourceReadModelError &&
      error.code === 'resource_not_found'
    ) {
      return jsonError(404, 'resource_not_found', '当前工作区不可用。');
    }
    return jsonError(503, 'resources_unavailable', '资源列表暂时不可用。');
  }
}
