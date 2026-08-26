'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createArtifact,
  fetchArtifactDetail,
  reviseArtifact,
  saveNoteArtifact,
  saveMarkdownDocumentArtifact,
  type ArtifactDetail,
  type ArtifactSourceReference,
  type CreatableArtifactKind,
  type ObservableArtifactKind,
} from './artifact-client';
import {
  pollArtifactToTerminal,
  type PollArtifactResult,
  type PollOutcome,
} from './artifact-polling-client';

export type GenerationPhase = 'confirm' | 'generating' | 'ready' | 'failed';
export type GenerationOutcome =
  'pending' | 'ready' | 'failed' | 'cancelled' | 'timed_out';

export interface GenerationState {
  phase: GenerationPhase;
  outcome: GenerationOutcome;
  /** A revision can fail while the previously committed Artifact remains usable. */
  revisionOutcome?: PollOutcome;
  kind: ObservableArtifactKind;
  artifactId?: string;
  title: string;
  detail?: ArtifactDetail;
  /** 服务端 generation job 的百分比进度（0-100）；轮询拉取，未拿到时缺省。 */
  progress?: number;
}

export interface ConfirmArtifactOptions {
  openWhenReady?: boolean;
}
export interface ProposedArtifact {
  artifactId: string;
  kind: ObservableArtifactKind;
  title: string;
}

export const isPollOutcomeGenerating = (outcome: PollOutcome) =>
  outcome === 'pending' || outcome === 'timed_out';

export const phaseFromPollOutcome = (outcome: PollOutcome): GenerationPhase => {
  if (outcome === 'ready') return 'ready';
  if (isPollOutcomeGenerating(outcome)) return 'generating';
  return 'failed';
};

export const outcomeFromPollOutcome = (
  outcome: PollOutcome,
): GenerationOutcome =>
  outcome === 'pending' || outcome === 'timed_out'
    ? outcome
    : outcome === 'cancelled'
      ? 'cancelled'
      : outcome === 'ready'
        ? 'ready'
        : 'failed';

/** 观察收敛到终态后是否值得通知只读列表刷新；本地取消不通知（任务仍在后台运行）。 */
export const shouldNotifySettled = (
  phase: GenerationPhase,
  resultOutcome: PollOutcome,
): boolean =>
  (phase === 'ready' || phase === 'failed') && resultOutcome !== 'cancelled';

export interface ObservationEpochController {
  begin: () => number;
  isCurrent: (epoch: number) => boolean;
}

export const createObservationEpochController =
  (): ObservationEpochController => {
    let epoch = 0;
    return {
      begin: () => ++epoch,
      isCurrent: (candidate) => candidate === epoch,
    };
  };

export const hasUsableArtifactVersion = (detail: ArtifactDetail): boolean =>
  detail.artifact.latestVersion > 0;

export function projectGenerationPollResult(
  artifactId: string,
  kind: ObservableArtifactKind,
  result: PollArtifactResult,
  titleFallback: string,
): GenerationState {
  return {
    phase: phaseFromPollOutcome(result.outcome),
    outcome: outcomeFromPollOutcome(result.outcome),
    kind,
    artifactId,
    title: result.detail.artifact.title || titleFallback,
    detail: result.detail,
  };
}

/**
 * Project a revision result without letting a failed/cancelled revision hide
 * the last committed version. The revision outcome stays available separately.
 */
export function projectRevisionPollResult(
  kind: ObservableArtifactKind,
  artifactId: string,
  titleFallback: string,
  result: PollArtifactResult,
): GenerationState {
  const hasUsableVersion = hasUsableArtifactVersion(result.detail);
  const objectOutcome = hasUsableVersion
    ? 'ready'
    : outcomeFromPollOutcome(result.outcome);
  return {
    phase: hasUsableVersion ? 'ready' : phaseFromPollOutcome(result.outcome),
    outcome: objectOutcome,
    revisionOutcome: result.outcome === 'ready' ? undefined : result.outcome,
    kind,
    artifactId,
    title: result.detail.artifact.title || titleFallback,
    detail: result.detail,
  };
}

function projectRevisionFailure(
  detail: ArtifactDetail,
  outcome: Extract<PollOutcome, 'failed' | 'pending'>,
): GenerationState {
  return {
    phase: 'ready',
    outcome: 'ready',
    revisionOutcome: outcome,
    kind: detail.artifact.kind as ObservableArtifactKind,
    artifactId: detail.artifact.id,
    title: detail.artifact.title,
    detail,
  };
}

export const ARTIFACT_KIND_LABELS: Record<ObservableArtifactKind, string> = {
  mind_map: '思维导图',
  slides: 'Slides',
  flashcards: '闪卡',
  audio_overview: '音频概览',
  note: '笔记',
  generated_image: '生成图片',
  picturebook: '知识绘本',
  markdown_document: 'Markdown 文档',
  web_app: 'Web App',
};
export interface ArtifactGenerationFlowOptions {
  /* 本地观察收敛到终态时回调；Dock 等只读列表借此保持最新，不负责重试语义。 */
  readonly onSettled?: () => void;
}

/** 显式确认后轮询；关闭页面不取消后端任务，资源列表与详情负责恢复。 */
export function useArtifactGeneration(
  options: ArtifactGenerationFlowOptions = {},
) {
  const { onSettled } = options;
  const [generation, setGeneration] = useState<GenerationState | null>(null);
  const [openDetail, setOpenDetail] = useState<ArtifactDetail | null>(null);
  const [canvasFull, setCanvasFull] = useState(false);
  const pollAbort = useRef<AbortController | null>(null);
  const observationEpoch = useRef(createObservationEpochController());
  const detailEpoch = useRef(createObservationEpochController());

  const beginObservation = useCallback(() => {
    pollAbort.current?.abort();
    return observationEpoch.current.begin();
  }, []);

  const isCurrentObservation = useCallback((epoch: number) => {
    return observationEpoch.current.isCurrent(epoch);
  }, []);

  useEffect(
    () => () => {
      observationEpoch.current.begin();
      detailEpoch.current.begin();
      pollAbort.current?.abort();
    },
    [],
  );

  const applyPollResult = useCallback(
    (
      artifactId: string,
      kind: ObservableArtifactKind,
      result: PollArtifactResult,
      titleFallback: string,
      options: ConfirmArtifactOptions = {},
    ) => {
      const next = projectGenerationPollResult(
        artifactId,
        kind,
        result,
        titleFallback,
      );
      setGeneration(next);
      /* 终态收敛后联动只读列表；本地取消不算终态（任务仍在后台运行）。 */
      if (shouldNotifySettled(next.phase, result.outcome)) {
        onSettled?.();
      }
      if (
        next.phase === 'ready' &&
        options.openWhenReady &&
        result.outcome !== 'cancelled'
      ) {
        setOpenDetail(result.detail);
        setCanvasFull(false);
      }
    },
    [onSettled],
  );

  const beginConfirm = useCallback(
    (kind: CreatableArtifactKind, defaultTitle: string) => {
      setGeneration({
        phase: 'confirm',
        outcome: 'pending',
        kind,
        title: defaultTitle,
      });
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
      const epoch = beginObservation();
      setGeneration({ phase: 'generating', outcome: 'pending', kind, title });
      try {
        const created = await createArtifact(kind, title, sources);
        if (!isCurrentObservation(epoch)) return;
        const controller = new AbortController();
        pollAbort.current = controller;
        const result = await pollArtifactToTerminal(created.artifact.id, {
          signal: controller.signal,
          onProgress: (progress) => {
            if (!isCurrentObservation(epoch)) return;
            setGeneration((current) =>
              current ? { ...current, progress } : current,
            );
          },
        });
        if (!isCurrentObservation(epoch)) return;
        applyPollResult(created.artifact.id, kind, result, title, options);
      } catch (error) {
        if (!isCurrentObservation(epoch)) return;
        if (error instanceof DOMException && error.name === 'AbortError') {
          setGeneration({
            phase: 'failed',
            outcome: 'cancelled',
            kind,
            title,
          });
          return;
        }
        setGeneration({ phase: 'failed', outcome: 'failed', kind, title });
        onSettled?.();
      }
    },
    [applyPollResult, beginObservation, isCurrentObservation, onSettled],
  );

  /**
   * 接管 Agent 工具已经创建的后台任务。这里不再次 POST，避免一个模型工具调用
   * 产生两份产物；只恢复现有 Artifact 的轮询与可选 Canvas 自动打开。
   */
  const observeProposedArtifact = useCallback(
    async (
      artifact: ProposedArtifact,
      options: ConfirmArtifactOptions = {},
    ) => {
      const epoch = beginObservation();
      setGeneration({
        phase: 'generating',
        outcome: 'pending',
        kind: artifact.kind,
        artifactId: artifact.artifactId,
        title: artifact.title,
      });
      try {
        const controller = new AbortController();
        pollAbort.current = controller;
        const result = await pollArtifactToTerminal(artifact.artifactId, {
          signal: controller.signal,
          onProgress: (progress) => {
            if (!isCurrentObservation(epoch)) return;
            setGeneration((current) =>
              current ? { ...current, progress } : current,
            );
          },
        });
        if (!isCurrentObservation(epoch)) return;
        applyPollResult(
          artifact.artifactId,
          artifact.kind,
          result,
          artifact.title,
          options,
        );
      } catch (error) {
        if (!isCurrentObservation(epoch)) return;
        if (error instanceof DOMException && error.name === 'AbortError') {
          setGeneration({
            phase: 'failed',
            outcome: 'cancelled',
            kind: artifact.kind,
            artifactId: artifact.artifactId,
            title: artifact.title,
          });
          return;
        }
        setGeneration({
          phase: 'failed',
          outcome: 'failed',
          kind: artifact.kind,
          artifactId: artifact.artifactId,
          title: artifact.title,
        });
        onSettled?.();
      }
    },
    [applyPollResult, beginObservation, isCurrentObservation, onSettled],
  );

  const openArtifact = useCallback(async (artifactId: string) => {
    const epoch = detailEpoch.current.begin();
    try {
      const detail = await fetchArtifactDetail(artifactId);
      if (detailEpoch.current.isCurrent(epoch)) setOpenDetail(detail);
    } catch {
      if (detailEpoch.current.isCurrent(epoch)) setOpenDetail(null);
    }
  }, []);

  const openArtifactVersion = useCallback(
    async (artifactId: string, version: number) => {
      const epoch = detailEpoch.current.begin();
      try {
        const detail = await fetchArtifactDetail(artifactId, version);
        if (detailEpoch.current.isCurrent(epoch)) setOpenDetail(detail);
      } catch {
        if (detailEpoch.current.isCurrent(epoch)) setOpenDetail(null);
      }
    },
    [],
  );

  const revise = useCallback(
    async (detail: ArtifactDetail, instruction: string) => {
      const baseVersion = detail.artifact.latestVersion;
      const epoch = beginObservation();
      setGeneration({
        phase: 'generating',
        outcome: 'pending',
        kind: detail.artifact.kind as ObservableArtifactKind,
        artifactId: detail.artifact.id,
        title: detail.artifact.title,
      });
      try {
        await reviseArtifact(detail.artifact.id, baseVersion, instruction);
        if (!isCurrentObservation(epoch)) return;
        const controller = new AbortController();
        pollAbort.current = controller;
        const result = await pollArtifactToTerminal(detail.artifact.id, {
          signal: controller.signal,
          minimumVersion: baseVersion + 1,
          onProgress: (progress) => {
            if (!isCurrentObservation(epoch)) return;
            setGeneration((current) =>
              current ? { ...current, progress } : current,
            );
          },
        });
        if (!isCurrentObservation(epoch)) return;
        const next = projectRevisionPollResult(
          detail.artifact.kind as ObservableArtifactKind,
          detail.artifact.id,
          detail.artifact.title,
          result,
        );
        setGeneration(next);
        if (next.phase === 'ready') {
          setOpenDetail((current) =>
            current?.artifact.id === detail.artifact.id
              ? result.detail
              : current,
          );
          onSettled?.();
        }
      } catch (error) {
        if (!isCurrentObservation(epoch)) return;
        if (error instanceof DOMException && error.name === 'AbortError') {
          /* Local observation cancellation is not a durable job cancellation.
             Keep the committed version usable and leave the revision pending. */
          setGeneration(projectRevisionFailure(detail, 'pending'));
          return;
        }
        setGeneration(projectRevisionFailure(detail, 'failed'));
        onSettled?.();
      }
    },
    [beginObservation, isCurrentObservation, onSettled, pollAbort],
  );

  const createBlankNote = useCallback(
    async (title: string) => {
      const epoch = beginObservation();
      setGeneration({
        phase: 'generating',
        outcome: 'pending',
        kind: 'note',
        title,
      });
      try {
        const created = await createArtifact(
          'note',
          title,
          [],
          `# ${title}\n\n`,
        );
        if (!isCurrentObservation(epoch)) return;
        const detail = await fetchArtifactDetail(created.artifact.id);
        if (!isCurrentObservation(epoch)) return;
        setGeneration({
          phase: 'ready',
          outcome: 'ready',
          kind: 'note',
          artifactId: created.artifact.id,
          title,
          detail,
        });
        setOpenDetail(detail);
        setCanvasFull(false);
        onSettled?.();
      } catch {
        setGeneration({
          phase: 'failed',
          outcome: 'failed',
          kind: 'note',
          title,
        });
        onSettled?.();
      }
    },
    [beginObservation, isCurrentObservation, onSettled],
  );

  const saveNote = useCallback(
    async (detail: ArtifactDetail, markdown: string) => {
      const baseVersion = detail.artifact.latestVersion;
      const epoch = beginObservation();
      setGeneration({
        phase: 'generating',
        outcome: 'pending',
        kind: 'note',
        artifactId: detail.artifact.id,
        title: detail.artifact.title,
      });
      try {
        if (detail.artifact.kind === 'markdown_document') {
          await saveMarkdownDocumentArtifact(
            detail.artifact.id,
            baseVersion,
            markdown,
          );
        } else {
          await saveNoteArtifact(detail.artifact.id, baseVersion, markdown);
        }
        if (!isCurrentObservation(epoch)) return;
        const updated = await fetchArtifactDetail(detail.artifact.id);
        if (!isCurrentObservation(epoch)) return;
        setOpenDetail(updated);
        setGeneration({
          phase: 'ready',
          outcome: 'ready',
          kind: detail.artifact.kind as ObservableArtifactKind,
          artifactId: detail.artifact.id,
          title: detail.artifact.title,
          detail: updated,
        });
        onSettled?.();
      } catch {
        setGeneration({
          phase: 'failed',
          outcome: 'failed',
          kind: detail.artifact.kind as ObservableArtifactKind,
          artifactId: detail.artifact.id,
          title: detail.artifact.title,
        });
        onSettled?.();
      }
    },
    [beginObservation, isCurrentObservation, onSettled],
  );

  const dismiss = useCallback(() => {
    beginObservation();
    setGeneration(null);
  }, [beginObservation]);

  return {
    generation,
    openDetail,
    canvasFull,
    setCanvasFull,
    beginConfirm,
    confirm,
    observeProposedArtifact,
    createBlankNote,
    revise,
    saveNote,
    openArtifact,
    openArtifactVersion,
    closeCanvas: () => {
      detailEpoch.current.begin();
      setOpenDetail(null);
      setCanvasFull(false);
    },
    dismiss,
  };
}

export {
  ArtifactCanvas,
  ArtifactConfirmSheet,
  ArtifactStatusCard,
} from './artifact-generation-ui';
