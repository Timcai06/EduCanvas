'use client';

import {
  CircleNotch,
  Headphones,
  TreeStructure,
  Warning,
} from '@phosphor-icons/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Sheet } from '@/features/workspace/shared/sheet';
import {
  createArtifact,
  fetchArtifactDetail,
  pollArtifactUntilSettled,
  reviseArtifact,
  type ArtifactDetail,
  type ArtifactSourceReference,
  type CreatableArtifactKind,
} from './artifact-client';
import { CanvasHost } from './canvas-host';
import {
  ArtifactGeneratingSkeleton,
  ArtifactProvenanceStrip,
  isArtifactGenerating,
} from './artifact-provenance';
import { MindMapRenderer } from './mind-map-renderer';
import { FlashcardsRenderer } from './flashcards-renderer';
import { SlidesRenderer } from './slides-renderer';
import { AudioOverviewPlayer } from './audio-overview-player';

export type GenerationPhase = 'confirm' | 'generating' | 'ready' | 'failed';

export interface GenerationState {
  phase: GenerationPhase;
  kind: CreatableArtifactKind;
  artifactId?: string;
  title: string;
  detail?: ArtifactDetail;
}

export interface ConfirmArtifactOptions {
  openWhenReady?: boolean;
}

export const ARTIFACT_KIND_LABELS: Record<CreatableArtifactKind, string> = {
  mind_map: '思维导图',
  slides: 'Slides',
  flashcards: '闪卡',
  audio_overview: '音频概览',
};

/**
 * 「生成思维导图」的确认 → 轮询 → 打开回路(M1 PR-J5b)。
 * 确认卡是显式用户动作:绝不静默生成(受控产物纪律);
 * 生成中关闭浏览器任务照跑,回来后经产物列表/详情恢复。
 */
export function useArtifactGeneration() {
  const [generation, setGeneration] = useState<GenerationState | null>(null);
  const [openDetail, setOpenDetail] = useState<ArtifactDetail | null>(null);
  const [canvasFull, setCanvasFull] = useState(false);
  const pollAbort = useRef<AbortController | null>(null);

  useEffect(() => () => pollAbort.current?.abort(), []);

  const beginConfirm = useCallback(
    (kind: CreatableArtifactKind, defaultTitle: string) => {
      setGeneration({ phase: 'confirm', kind, title: defaultTitle });
    },
    [],
  );

  const confirm = useCallback(
    async (
      kind: CreatableArtifactKind,
      title: string,
      sources: readonly ArtifactSourceReference[] = [],
      options: ConfirmArtifactOptions = {},
    ) => {
      setGeneration({ phase: 'generating', kind, title });
      try {
        const created = await createArtifact(kind, title, sources);
        pollAbort.current = new AbortController();
        const detail = await pollArtifactUntilSettled(created.artifact.id, {
          signal: pollAbort.current.signal,
        });
        const succeeded =
          detail.artifact.latestVersion > 0 &&
          detail.latestJob?.status !== 'failed';
        setGeneration({
          phase: succeeded ? 'ready' : 'failed',
          kind,
          artifactId: created.artifact.id,
          title: detail.artifact.title,
          detail,
        });
        if (succeeded && options.openWhenReady) {
          setOpenDetail(detail);
          setCanvasFull(false);
        }
      } catch {
        setGeneration({ phase: 'failed', kind, title });
      }
    },
    [],
  );

  const openArtifact = useCallback(async (artifactId: string) => {
    try {
      setOpenDetail(await fetchArtifactDetail(artifactId));
    } catch {
      setOpenDetail(null);
    }
  }, []);

  const openArtifactVersion = useCallback(
    async (artifactId: string, version: number) => {
      try {
        setOpenDetail(await fetchArtifactDetail(artifactId, version));
      } catch {
        setOpenDetail(null);
      }
    },
    [],
  );

  const revise = useCallback(
    async (detail: ArtifactDetail, instruction: string) => {
      const baseVersion = detail.artifact.latestVersion;
      setGeneration({
        phase: 'generating',
        kind: detail.artifact.kind as CreatableArtifactKind,
        artifactId: detail.artifact.id,
        title: detail.artifact.title,
      });
      try {
        await reviseArtifact(detail.artifact.id, baseVersion, instruction);
        pollAbort.current?.abort();
        pollAbort.current = new AbortController();
        const updated = await pollArtifactUntilSettled(detail.artifact.id, {
          signal: pollAbort.current.signal,
          minimumVersion: baseVersion + 1,
        });
        const succeeded =
          updated.artifact.latestVersion >= baseVersion + 1 &&
          updated.latestJob?.status !== 'failed';
        setGeneration({
          phase: succeeded ? 'ready' : 'failed',
          kind: detail.artifact.kind as CreatableArtifactKind,
          artifactId: detail.artifact.id,
          title: detail.artifact.title,
          detail: updated,
        });
        if (succeeded) {
          setOpenDetail((current) =>
            current?.artifact.id === detail.artifact.id ? updated : current,
          );
        }
      } catch {
        setGeneration({
          phase: 'failed',
          kind: detail.artifact.kind as CreatableArtifactKind,
          artifactId: detail.artifact.id,
          title: detail.artifact.title,
        });
      }
    },
    [],
  );

  const dismiss = useCallback(() => {
    pollAbort.current?.abort();
    setGeneration(null);
  }, []);

  return {
    generation,
    openDetail,
    canvasFull,
    setCanvasFull,
    beginConfirm,
    confirm,
    revise,
    openArtifact,
    openArtifactVersion,
    closeCanvas: () => {
      setOpenDetail(null);
      setCanvasFull(false);
    },
    dismiss,
  };
}

/** 确认卡:标题可改,显式点击才创建。 */
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
          <span className="text-xs font-medium text-ink-faint">产物标题</span>
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

/** 生成状态卡:悬浮在输入坞上方,不进消息账本(它不是对话消息)。 */
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
  return (
    <div
      role="status"
      className="mx-auto mb-2 flex w-full max-w-3xl items-center gap-3 rounded-2xl border border-line bg-card/95 px-4 py-3 shadow-[var(--shadow-float)] backdrop-blur"
    >
      <span
        aria-hidden="true"
        className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent"
      >
        {generation.phase === 'generating' ? (
          <CircleNotch
            size={18}
            className="animate-spin motion-reduce:animate-none"
          />
        ) : generation.phase === 'failed' ? (
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
        <span className="block text-xs text-ink-muted">
          {generation.phase === 'generating'
            ? '后台生成中…关闭页面也不会中断'
            : generation.phase === 'ready'
              ? generation.detail &&
                generation.detail.artifact.latestVersion > 1
                ? `${ARTIFACT_KIND_LABELS[generation.kind]}已更新至 v${generation.detail.artifact.latestVersion}`
                : `${ARTIFACT_KIND_LABELS[generation.kind]}已生成`
              : '生成失败，可稍后从产物列表重试'}
        </span>
      </span>
      {generation.phase === 'ready' ? (
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

/** 产物 Canvas：统一承载结构化产物、只读历史与基于最新版本的共创入口。 */
export function ArtifactCanvas({
  detail,
  isFull,
  onToggleFull,
  onClose,
  onSelectVersion,
  onRevise,
  revising = false,
}: {
  detail: ArtifactDetail;
  isFull: boolean;
  onToggleFull: () => void;
  onClose: () => void;
  onSelectVersion: (version: number) => void;
  onRevise: (instruction: string) => void;
  revising?: boolean;
}) {
  const [instruction, setInstruction] = useState('');
  const displayedVersion = detail.version?.version ?? 0;
  const isLatest = displayedVersion === detail.artifact.latestVersion;
  const canRevise = ['mind_map', 'slides', 'flashcards'].includes(
    detail.artifact.kind,
  );
  const generating = isArtifactGenerating(detail, revising);
  /* 生成中且当前展示的最新版还没有内容:显示骨架而非空态文案 */
  const showSkeleton = generating && isLatest && !detail.version;
  const versionLabel = (version: {
    version: number;
    revisionInstruction: string | null;
  }): string => {
    const latest =
      version.version === detail.artifact.latestVersion ? ' · 最新' : '';
    const origin =
      version.version === 1
        ? '初始生成'
        : version.revisionInstruction
          ? `你的修改：${version.revisionInstruction.slice(0, 24)}`
          : '共创修改';
    return `v${version.version}${latest} · ${origin}`;
  };
  return (
    <CanvasHost
      ariaLabel="产物Canvas"
      title={detail.artifact.title}
      closeLabel="关闭"
      onClose={onClose}
      isFull={isFull}
      onToggleFull={onToggleFull}
    >
      <div className="flex min-h-0 flex-1 flex-col">
        <ArtifactProvenanceStrip detail={detail} revising={revising} />
        <div className="flex shrink-0 items-center gap-3 border-b border-line px-4 py-2.5">
          <label className="flex items-center gap-2 text-xs text-ink-muted">
            <span>版本</span>
            <select
              aria-label="Canvas版本"
              value={displayedVersion || ''}
              onChange={(event) => onSelectVersion(Number(event.target.value))}
              className="max-w-56 rounded-lg border border-line bg-surface px-2 py-1.5 text-xs font-medium text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {detail.versions.map((version) => (
                <option key={version.version} value={version.version}>
                  {versionLabel(version)}
                </option>
              ))}
            </select>
          </label>
          <span className="text-xs text-ink-faint">
            {isLatest ? '当前版本' : '历史只读版本'}
          </span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 lg:p-5">
          {showSkeleton ? (
            <ArtifactGeneratingSkeleton />
          ) : detail.artifact.kind === 'mind_map' && detail.version ? (
            <MindMapRenderer
              key={displayedVersion}
              content={detail.version.content}
            />
          ) : detail.artifact.kind === 'slides' && detail.version ? (
            <SlidesRenderer
              key={displayedVersion}
              content={detail.version.content}
            />
          ) : detail.artifact.kind === 'flashcards' && detail.version ? (
            <FlashcardsRenderer
              key={displayedVersion}
              content={detail.version.content}
            />
          ) : detail.artifact.kind === 'audio_overview' &&
            detail.version?.media ? (
            <AudioOverviewPlayer media={detail.version.media} />
          ) : (
            <p className="text-sm text-ink-muted">该产物还没有可显示的版本。</p>
          )}
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
                className="min-h-12 flex-1 resize-none rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:text-ink-faint"
              />
              <button
                type="submit"
                disabled={!instruction.trim() || !isLatest || revising}
                className="min-h-10 shrink-0 rounded-full bg-accent px-4 text-sm font-semibold text-card transition-colors hover:bg-accent-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:bg-surface-strong disabled:text-ink-faint"
              >
                {revising ? '生成中…' : '生成新版本'}
              </button>
            </div>
            <p className="mt-1.5 text-xs text-ink-faint">
              修改会基于 v{detail.artifact.latestVersion}、当前 Notebook
              对话和这条要求生成完整新版本。
            </p>
          </form>
        ) : null}
      </div>
    </CanvasHost>
  );
}
