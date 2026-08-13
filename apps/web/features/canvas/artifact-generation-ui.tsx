'use client';

import {
  CircleNotch,
  Headphones,
  TreeStructure,
  Warning,
} from '@phosphor-icons/react';
import { useState } from 'react';
import { Sheet } from '@/components/sheet';
import type { ArtifactDetail, CreatableArtifactKind } from './artifact-client';
import {
  ARTIFACT_KIND_LABELS,
  type GenerationState,
} from './artifact-generation-flow';
import { CanvasHost } from './canvas-host';
import { resolveArtifactContentView } from './artifact-content-view';
import { ArtifactProvenanceStrip } from './artifact-provenance';
import { ArtifactCanvasToolbar } from './artifact-canvas-toolbar';
import { ArtifactCanvasContent } from './artifact-canvas-content';
import { MarkdownVersionDiffPanel } from './markdown-version-diff';

export function ArtifactConfirmSheet({
  kind,
  defaultTitle,
  sourceCount = 0,
  onConfirm,
  onClose,
}: {
  kind: CreatableArtifactKind;
  defaultTitle: string;
  sourceCount?: number;
  onConfirm: (title: string) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(defaultTitle);
  const trimmed = title.trim();
  const kindLabel = ARTIFACT_KIND_LABELS[kind];
  return (
    <Sheet label={`生成${kindLabel}`} onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm leading-6 text-ink-muted">
          {kind === 'audio_overview'
            ? `将根据当前勾选的 ${sourceCount} 项 PDF / 网页来源生成脚本与语音。关闭页面不会中断。`
            : `将根据当前对话生成一份${kindLabel}，由后台任务完成——关闭页面也不会中断。`}
        </p>
        {kind === 'audio_overview' && sourceCount === 0 ? (
          <p role="alert" className="text-sm text-danger">
            请先在来源面板勾选至少一项已解析的 PDF 或网页。
          </p>
        ) : null}
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink-muted">产物标题</span>
          <input
            value={title}
            maxLength={120}
            onChange={(event) => setTitle(event.currentTarget.value)}
            className="w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-sm text-ink outline-none focus-visible:border-accent/55 focus-visible:ring-2 focus-visible:ring-accent/30"
          />
        </label>
        <button
          type="button"
          disabled={
            trimmed.length === 0 ||
            (kind === 'audio_overview' && sourceCount === 0)
          }
          onClick={() => onConfirm(trimmed)}
          className="min-h-10 w-full rounded-full bg-accent px-5 py-2 text-sm font-semibold text-card transition-colors hover:bg-accent-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:bg-surface-strong disabled:text-ink-faint"
        >
          开始生成
        </button>
      </div>
    </Sheet>
  );
}

export function ArtifactStatusCard({
  generation,
  onOpen,
  onDismiss,
  dismissable = true,
}: {
  generation: GenerationState;
  onOpen: () => void;
  onDismiss: () => void;
  dismissable?: boolean;
}) {
  const failed =
    generation.phase === 'failed' ||
    generation.outcome === 'cancelled' ||
    generation.revisionOutcome === 'failed' ||
    generation.revisionOutcome === 'cancelled';
  const label =
    generation.revisionOutcome === 'cancelled'
      ? `本次修改已取消，仍可打开 v${generation.detail?.artifact.latestVersion ?? 1}`
      : generation.revisionOutcome === 'failed'
        ? `本次修改失败，仍可打开 v${generation.detail?.artifact.latestVersion ?? 1}`
        : generation.revisionOutcome === 'timed_out'
          ? `本次修改仍在后台处理，当前可打开 v${generation.detail?.artifact.latestVersion ?? 1}`
          : generation.outcome === 'cancelled'
            ? '生成已取消'
            : generation.outcome === 'timed_out'
              ? '后台仍在处理，可关闭提示并稍后从资源库查看'
              : generation.phase === 'generating'
                ? '后台生成中…关闭页面也不会中断'
                : generation.phase === 'ready'
                  ? generation.detail &&
                    generation.detail.artifact.latestVersion > 1
                    ? `${ARTIFACT_KIND_LABELS[generation.kind]}已更新至 v${generation.detail.artifact.latestVersion}`
                    : `${ARTIFACT_KIND_LABELS[generation.kind]}已生成`
                  : '生成失败，可稍后从产物列表重试';
  return (
    <div
      role="status"
      className="mx-auto mb-2 flex w-full max-w-3xl items-center gap-3 rounded-2xl border border-line bg-card/95 px-4 py-3 shadow-[var(--shadow-float)] backdrop-blur"
    >
      <span
        aria-hidden="true"
        className={`grid size-9 shrink-0 place-items-center rounded-xl ${failed ? 'bg-cinnabar-soft text-cinnabar-strong' : 'bg-accent-soft text-accent'}`}
      >
        {generation.phase === 'generating' ? (
          <CircleNotch
            size={18}
            className="animate-spin motion-reduce:animate-none"
          />
        ) : failed ? (
          <Warning size={18} />
        ) : generation.kind === 'audio_overview' ? (
          <Headphones size={18} />
        ) : (
          <TreeStructure size={18} />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-ink">
          {generation.title}
        </span>
        <span
          className={`block text-xs ${failed ? 'text-cinnabar-strong' : 'text-ink-muted'}`}
        >
          {label}
        </span>
      </span>
      {generation.phase === 'ready' && generation.detail ? (
        <button
          type="button"
          onClick={onOpen}
          className="min-h-9 shrink-0 rounded-full bg-accent px-4 text-sm font-semibold text-card transition-colors hover:bg-accent-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          打开
        </button>
      ) : null}
      {dismissable ? (
        <button
          type="button"
          aria-label="关闭生成提示"
          onClick={onDismiss}
          className="min-h-9 shrink-0 rounded-full px-3 text-sm text-ink-muted transition-colors hover:bg-surface-strong hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          关闭
        </button>
      ) : null}
    </div>
  );
}

export function ArtifactCanvas({
  detail,
  isFull,
  onToggleFull,
  onClose,
  onDeleted,
  onSelectVersion,
  onRevise,
  onSaveNote,
  revising = false,
  canExitFullscreen,
}: {
  detail: ArtifactDetail;
  isFull: boolean;
  onToggleFull: () => void;
  onClose: () => void;
  onDeleted: (artifactId: string) => void;
  onSelectVersion: (version: number) => void;
  onRevise: (instruction: string) => void;
  onSaveNote: (markdown: string) => void;
  revising?: boolean;
  canExitFullscreen?: boolean;
}) {
  const [instruction, setInstruction] = useState('');
  const displayedVersion = detail.version?.version ?? 0;
  const isLatest = displayedVersion === detail.artifact.latestVersion;
  const canRevise = [
    'mind_map',
    'slides',
    'flashcards',
    'note',
    'markdown_document',
    'web_app',
  ].includes(detail.artifact.kind);
  const contentView = resolveArtifactContentView(detail, revising);
  return (
    <CanvasHost
      ariaLabel="产物Canvas"
      title={detail.artifact.title}
      closeLabel="关闭"
      onClose={onClose}
      isFull={isFull}
      onToggleFull={onToggleFull}
      canExitFullscreen={canExitFullscreen}
    >
      <div className="flex min-h-0 flex-1 flex-col">
        <ArtifactProvenanceStrip detail={detail} revising={revising} />
        <ArtifactCanvasToolbar
          detail={detail}
          displayedVersion={displayedVersion}
          onSelectVersion={onSelectVersion}
          onDeleted={onDeleted}
          onRestored={() => onSelectVersion(detail.artifact.latestVersion + 1)}
        />
        {detail.artifact.kind === 'markdown_document' &&
        !isLatest &&
        detail.version ? (
          <MarkdownVersionDiffPanel
            artifactId={detail.artifact.id}
            displayedVersion={displayedVersion}
            version={{
              content: detail.version.content,
              contentVersion: 1,
              version: detail.version.version,
            }}
          />
        ) : null}
        <div
          role="region"
          aria-label="Canvas 内容"
          className={
            detail.artifact.kind === 'mind_map'
              ? 'flex min-h-0 flex-1 overflow-hidden p-2 lg:p-3'
              : 'min-h-0 flex-1 overflow-y-auto p-4 lg:p-5'
          }
        >
          <ArtifactCanvasContent
            contentView={contentView}
            detail={detail}
            revising={revising}
            onSaveNote={onSaveNote}
          />
        </div>
        {canRevise ? (
          <form
            className="shrink-0 border-t border-line bg-canvas/90 p-3 backdrop-blur"
            onSubmit={(event) => {
              event.preventDefault();
              const trimmed = instruction.trim();
              if (!trimmed || !isLatest || revising) return;
              onRevise(trimmed);
              setInstruction('');
            }}
          >
            <label className="sr-only" htmlFor={`revise-${detail.artifact.id}`}>
              告诉 AI 如何修改
            </label>
            <div className="flex items-end gap-2">
              <textarea
                id={`revise-${detail.artifact.id}`}
                aria-label="告诉 AI 如何修改"
                value={instruction}
                maxLength={2_000}
                rows={2}
                disabled={!isLatest || revising}
                placeholder={
                  isLatest
                    ? '告诉 AI 如何修改这个 Canvas…'
                    : '请先切回最新版本再继续修改'
                }
                onChange={(event) => setInstruction(event.target.value)}
                className="ec-input min-h-12 flex-1 resize-none rounded-xl px-3 py-2 text-sm text-ink disabled:text-ink-faint"
              />
              <button
                type="submit"
                disabled={!instruction.trim() || !isLatest || revising}
                className="min-h-10 shrink-0 rounded-full bg-accent px-4 text-sm font-semibold text-card transition-colors hover:bg-accent-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:bg-surface-strong disabled:text-ink-faint"
              >
                {revising ? '生成中…' : '生成新版本'}
              </button>
            </div>
            <p className="mt-1.5 text-xs text-ink-muted">
              修改会基于 v{detail.artifact.latestVersion}、当前 Notebook
              对话和这条要求生成完整新版本。
            </p>
          </form>
        ) : null}
      </div>
    </CanvasHost>
  );
}
