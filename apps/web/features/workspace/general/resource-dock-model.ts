import type { WorkspaceResourceSummary } from '@educanvas/canvas-protocol';

export const RESOURCE_DOCK_CATEGORIES = ['source', 'artifact', 'all'] as const;
export type ResourceDockCategory = (typeof RESOURCE_DOCK_CATEGORIES)[number];

export interface ResourceDockItem {
  readonly summary: WorkspaceResourceSummary;
  readonly rendererId: string;
  readonly status: WorkspaceResourceSummary['status'];
  readonly contextEnabled: boolean | null;
  readonly surfaceRestState: WorkspaceResourceSummary['surface']['restState'];
}

export interface ResourceDockSection {
  readonly id: ResourceDockCategory;
  readonly label: string;
  readonly items: readonly ResourceDockItem[];
  readonly visibleItems: readonly ResourceDockItem[];
  readonly hiddenLoadedCount: number;
  readonly hasUnloadedPages: boolean;
}

export interface ResourceDockModel {
  readonly sections: readonly ResourceDockSection[];
}

const labels: Record<ResourceDockCategory, string> = {
  source: '来源',
  artifact: 'AI 产物',
  all: '全部资源',
};

function item(summary: WorkspaceResourceSummary): ResourceDockItem {
  return {
    summary,
    rendererId: summary.renderer.rendererId,
    status: summary.status,
    contextEnabled:
      summary.resourceKind === 'source' ? summary.context.enabled : null,
    surfaceRestState: summary.surface.restState,
  };
}

/**
 * Dock 只投影批量摘要；这里不做 detail 请求，也不限制条目数量。
 * `remainingCount` 供分页接线显示真实剩余数，当前页不会静默丢弃。
 */
export function buildResourceDockModel(
  summaries: readonly WorkspaceResourceSummary[],
  options: { visibleLimit?: number; hasUnloadedPages?: boolean } = {},
): ResourceDockModel {
  const source = summaries
    .filter((summary) => summary.resourceKind === 'source')
    .map(item);
  const artifact = summaries
    .filter((summary) => summary.resourceKind === 'artifact')
    .map(item);
  const all = summaries.map(item);
  const lists: Record<ResourceDockCategory, readonly ResourceDockItem[]> = {
    source,
    artifact,
    all,
  };
  return {
    sections: RESOURCE_DOCK_CATEGORIES.map((id) => {
      const visibleLimit = options.visibleLimit ?? lists[id].length;
      return {
        id,
        label: labels[id],
        items: lists[id],
        visibleItems: lists[id].slice(0, visibleLimit),
        hiddenLoadedCount: Math.max(0, lists[id].length - visibleLimit),
        hasUnloadedPages: options.hasUnloadedPages ?? false,
      };
    }),
  };
}
