'use client';

import { useState } from 'react';
import { deleteArtifact, type ArtifactDetail } from './artifact-client';

function versionLabel(
  version: { version: number; revisionInstruction: string | null },
  latestVersion: number,
): string {
  const latest = version.version === latestVersion ? ' · 最新' : '';
  const origin =
    version.version === 1
      ? '初始生成'
      : version.revisionInstruction
        ? `你的修改：${version.revisionInstruction.slice(0, 24)}`
        : '共创修改';
  return `v${version.version}${latest} · ${origin}`;
}

/**
 * Canvas 版本切换与删除确认。删除失败会留在原 Canvas 并给出稳定提示，
 * 成功后由拥有列表状态的父组件移除对应条目。
 */
export function ArtifactCanvasToolbar({
  detail,
  displayedVersion,
  onSelectVersion,
  onDeleted,
}: {
  detail: ArtifactDetail;
  displayedVersion: number;
  onSelectVersion: (version: number) => void;
  onDeleted: (artifactId: string) => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteFailed, setDeleteFailed] = useState(false);
  const isLatest = displayedVersion === detail.artifact.latestVersion;
  const canDelete =
    detail.canvasResource?.allowedActions.includes('delete') ?? false;

  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-line px-4 py-2.5">
      <label className="flex items-center gap-2 text-xs text-ink-muted">
        <span>版本</span>
        <select
          aria-label="Canvas版本"
          value={displayedVersion || ''}
          onChange={(event) => onSelectVersion(Number(event.target.value))}
          className="max-w-56 rounded-lg border border-line bg-surface px-2 py-1.5 text-xs font-medium text-ink outline-none transition-colors hover:border-accent/40 focus-visible:ring-2 focus-visible:ring-accent"
        >
          {detail.versions.map((version) => (
            <option key={version.version} value={version.version}>
              {versionLabel(version, detail.artifact.latestVersion)}
            </option>
          ))}
        </select>
      </label>
      <span className="text-xs text-ink-muted">
        {isLatest ? '当前版本' : '历史只读版本'}
      </span>
      {canDelete && !confirmDelete ? (
        <button
          type="button"
          onClick={() => {
            setDeleteFailed(false);
            setConfirmDelete(true);
          }}
          className="ml-auto text-xs text-cinnabar transition-colors hover:text-cinnabar-strong"
        >
          删除
        </button>
      ) : confirmDelete ? (
        <span className="ml-auto flex items-center gap-2">
          <span className="text-xs text-cinnabar">确认删除？</span>
          <button
            type="button"
            disabled={deleting}
            onClick={async () => {
              setDeleting(true);
              setDeleteFailed(false);
              try {
                await deleteArtifact(detail.artifact.id);
                onDeleted(detail.artifact.id);
              } catch {
                setDeleting(false);
                setConfirmDelete(false);
                setDeleteFailed(true);
              }
            }}
            className="rounded-full bg-cinnabar px-3 py-1 text-xs font-medium text-card transition-colors hover:bg-cinnabar-strong disabled:opacity-50"
          >
            {deleting ? '删除中…' : '确认'}
          </button>
          <button
            type="button"
            disabled={deleting}
            onClick={() => setConfirmDelete(false)}
            className="rounded-full border border-line px-3 py-1 text-xs text-ink-muted transition-colors hover:bg-surface-strong disabled:opacity-50"
          >
            取消
          </button>
        </span>
      ) : null}
      {deleteFailed ? (
        <span role="alert" className="ml-auto text-xs text-cinnabar">
          删除失败，请重试。
        </span>
      ) : null}
    </div>
  );
}
