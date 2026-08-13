'use client';

import type { WorkspaceResourceSummary } from '@educanvas/canvas-protocol';
import type { AssetItem } from '@/features/assets/assets-drawer';
import { StudioResourceLibrary } from './studio-resource-library';
import { StudioSourceActions } from './studio-source-actions';
import './studio-workspace.css';

/**
 * Studio compatibility shell over the unified summary library.
 * Browsing stays summary-only; Source mutations reuse the existing authorized
 * AssetItem seam, while opening either kind goes through the caller's common gate.
 */
export function StudioWorkspace({
  summaries,
  assets,
  loading,
  error,
  hasMore,
  onOpen,
  onLoadMore,
  onRetry,
  onToggleSource,
  onRenameSource,
  onDeleteSource,
}: {
  summaries: readonly WorkspaceResourceSummary[];
  assets: readonly AssetItem[];
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  onOpen: (summary: WorkspaceResourceSummary) => void;
  onLoadMore: () => void;
  onRetry: () => void;
  onToggleSource: (asset: AssetItem) => void;
  onRenameSource: (asset: AssetItem, displayName: string) => void;
  onDeleteSource: (asset: AssetItem) => void;
}) {
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
  return (
    <div className="pointer-events-auto h-full p-4 pt-12">
      <StudioResourceLibrary
        summaries={summaries}
        loading={loading}
        error={error}
        hasMore={hasMore}
        onOpen={onOpen}
        onLoadMore={onLoadMore}
        onRetry={onRetry}
        renderActions={(summary) => {
          if (summary.resourceKind !== 'source') return null;
          const asset = assetsById.get(summary.resourceId);
          return asset ? (
            <StudioSourceActions
              key={asset.id}
              asset={asset}
              onToggleEnabled={onToggleSource}
              onRename={onRenameSource}
              onDelete={onDeleteSource}
            />
          ) : (
            <span className="shrink-0 text-xs text-ink-muted">打开后管理</span>
          );
        }}
      />
    </div>
  );
}
