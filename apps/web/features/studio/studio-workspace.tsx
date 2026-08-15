'use client';

import type { WorkspaceResourceSummary } from '@educanvas/canvas-protocol';
import { ArrowLeft, Stack } from '@phosphor-icons/react';
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
  onClose,
  notebookTitle,
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
  onClose: () => void;
  notebookTitle: string | null;
}) {
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
  return (
    <section
      className="studio-console-page"
      aria-label="当前笔记本的资源控制台"
    >
      <header className="studio-console-page__bar">
        <button type="button" onClick={onClose} aria-label="返回对话页面">
          <ArrowLeft size={18} weight="bold" aria-hidden="true" />
          返回对话
        </button>
        <div>
          <span>当前笔记本</span>
          <strong>{notebookTitle ?? '未命名笔记本'}</strong>
        </div>
        <p>
          <Stack size={17} weight="duotone" aria-hidden="true" />
          Unified resource console
        </p>
      </header>
      <div className="studio-console-page__body">
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
              <span className="shrink-0 text-xs text-ink-muted">
                打开后管理
              </span>
            );
          }}
        />
      </div>
    </section>
  );
}
