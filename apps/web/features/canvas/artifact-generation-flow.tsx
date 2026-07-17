'use client';

import { CircleNotch, TreeStructure, Warning } from '@phosphor-icons/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Sheet } from '@/features/workspace/shared/sheet';
import {
  createArtifact,
  fetchArtifactDetail,
  pollArtifactUntilSettled,
  type ArtifactDetail,
  type CreatableArtifactKind,
} from './artifact-client';
import { CanvasHost } from './canvas-host';
import { MindMapRenderer } from './mind-map-renderer';
import { SlidesRenderer } from './slides-renderer';

export type GenerationPhase = 'confirm' | 'generating' | 'ready' | 'failed';

export interface GenerationState {
  phase: GenerationPhase;
  kind: CreatableArtifactKind;
  artifactId?: string;
  title: string;
  detail?: ArtifactDetail;
}

export const ARTIFACT_KIND_LABELS: Record<CreatableArtifactKind, string> = {
  mind_map: '思维导图',
  slides: 'Slides',
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

  const confirm = useCallback(async (kind: CreatableArtifactKind, title: string) => {
    setGeneration({ phase: 'generating', kind, title });
    try {
      const created = await createArtifact(kind, title);
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
    } catch {
      setGeneration({ phase: 'failed', kind, title });
    }
  }, []);

  const openArtifact = useCallback(async (artifactId: string) => {
    try {
      setOpenDetail(await fetchArtifactDetail(artifactId));
    } catch {
      setOpenDetail(null);
    }
  }, []);

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
    openArtifact,
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
  onConfirm,
  onClose,
}: {
  kind: CreatableArtifactKind;
  defaultTitle: string;
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
          将根据当前对话生成一份{kindLabel}，由后台任务完成——关闭页面也不会中断。
        </p>
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
          disabled={trimmed.length === 0}
          onClick={() => onConfirm(trimmed)}
          className="min-h-10 w-full rounded-full bg-accent px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:bg-surface-strong disabled:text-ink-faint"
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
}: {
  generation: GenerationState;
  onOpen: () => void;
  onDismiss: () => void;
}) {
  return (
    <div
      role="status"
      className="mx-auto mb-2 flex w-full max-w-3xl items-center gap-3 rounded-2xl border border-line bg-surface/90 px-4 py-3 shadow-[var(--shadow-float)] backdrop-blur"
    >
      <span
        aria-hidden="true"
        className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent"
      >
        {generation.phase === 'generating' ? (
          <CircleNotch size={18} className="animate-spin motion-reduce:animate-none" />
        ) : generation.phase === 'failed' ? (
          <Warning size={18} />
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
              ? `${ARTIFACT_KIND_LABELS[generation.kind]}已生成`
              : '生成失败，可稍后从产物列表重试'}
        </span>
      </span>
      {generation.phase === 'ready' ? (
        <button
          type="button"
          onClick={onOpen}
          className="min-h-9 shrink-0 rounded-full bg-accent px-4 text-sm font-semibold text-white transition-colors hover:bg-accent-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          打开
        </button>
      ) : null}
      <button
        type="button"
        aria-label="关闭生成提示"
        onClick={onDismiss}
        className="min-h-9 shrink-0 rounded-full px-3 text-sm text-ink-muted transition-colors hover:bg-surface-strong hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        关闭
      </button>
    </div>
  );
}

/** 产物 Canvas:与判分/沙箱同一宿主形态,当前注册 mind_map 渲染。 */
export function ArtifactCanvas({
  detail,
  isFull,
  onToggleFull,
  onClose,
}: {
  detail: ArtifactDetail;
  isFull: boolean;
  onToggleFull: () => void;
  onClose: () => void;
}) {
  return (
    <CanvasHost
      ariaLabel="产物Canvas"
      title={detail.artifact.title}
      closeLabel="关闭"
      onClose={onClose}
      isFull={isFull}
      onToggleFull={onToggleFull}
    >
      <div className="min-h-0 flex-1 overflow-y-auto p-4 lg:p-5">
        {detail.artifact.kind === 'mind_map' && detail.latestVersion ? (
          <MindMapRenderer content={detail.latestVersion.content} />
        ) : detail.artifact.kind === 'slides' && detail.latestVersion ? (
          <SlidesRenderer content={detail.latestVersion.content} />
        ) : (
          <p className="text-sm text-ink-muted">该产物还没有可显示的版本。</p>
        )}
      </div>
    </CanvasHost>
  );
}
