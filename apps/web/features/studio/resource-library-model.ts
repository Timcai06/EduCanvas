import type { WorkspaceResourceSummary } from '@educanvas/canvas-protocol';

export type ResourceLibraryCategory = 'source' | 'artifact' | 'all';
export type ResourceLibrarySortKey = 'updatedAt' | 'title' | 'status';
export type ResourceLibrarySortOrder = 'asc' | 'desc';

export interface ResourceLibraryQuery {
  readonly search?: string;
  readonly category?: ResourceLibraryCategory;
  readonly status?: WorkspaceResourceSummary['status'] | 'all';
  readonly contextEnabled?: boolean | 'all';
  readonly sort?: ResourceLibrarySortKey;
  readonly order?: ResourceLibrarySortOrder;
}

const statusRank: Record<WorkspaceResourceSummary['status'], number> = {
  processing: 0,
  ready: 1,
  failed: 2,
  unavailable: 3,
  archived: 4,
};

/**
 * 资源库的唯一摘要查询模型。输入不会被修改，查询只读取标题、类别、状态、
 * Source context 和更新时间；正文、媒体和 detail 均不在此边界内。
 */
export function queryResourceLibrary(
  summaries: readonly WorkspaceResourceSummary[],
  query: ResourceLibraryQuery = {},
): readonly WorkspaceResourceSummary[] {
  const needle = query.search?.trim().toLocaleLowerCase() ?? '';
  const category = query.category ?? 'all';
  const status = query.status ?? 'all';
  const contextEnabled = query.contextEnabled ?? 'all';
  const filtered = summaries.filter((summary) => {
    if (category !== 'all' && summary.resourceKind !== category) return false;
    if (status !== 'all' && summary.status !== status) return false;
    if (needle && !summary.title.toLocaleLowerCase().includes(needle))
      return false;
    if (
      contextEnabled !== 'all' &&
      (summary.resourceKind !== 'source' ||
        summary.context.enabled !== contextEnabled)
    ) {
      return false;
    }
    return true;
  });

  const sort = query.sort ?? 'updatedAt';
  const order = query.order ?? 'desc';
  return filtered
    .map((summary, index) => ({ summary, index }))
    .sort((left, right) => {
      const a = left.summary;
      const b = right.summary;
      let comparison = 0;
      if (sort === 'title')
        comparison = a.title.localeCompare(b.title, 'zh-Hans');
      else if (sort === 'status')
        comparison = statusRank[a.status] - statusRank[b.status];
      else comparison = a.updatedAt.localeCompare(b.updatedAt);
      if (comparison === 0) return left.index - right.index;
      return order === 'asc' ? comparison : -comparison;
    })
    .map(({ summary }) => summary);
}

/** Action rendering is an authorization projection, never a client-side inference. */
export function getResourceLibraryActions(
  summary: WorkspaceResourceSummary,
): readonly WorkspaceResourceSummary['allowedActions'][number][] {
  return [...summary.allowedActions];
}

/** Summary controls discovery only; fresh CanvasResource still re-authorizes on open. */
export function canOpenResourceLibraryItem(
  summary: WorkspaceResourceSummary,
): boolean {
  return (
    summary.allowedActions.includes('view') &&
    summary.version !== null &&
    summary.status !== 'failed' &&
    summary.status !== 'unavailable'
  );
}
