'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
} from 'react';
import {
  Composer,
  type ComposerVoiceControl,
} from '@/features/composer/composer';
import { useVoiceCapabilityQuery } from './voice-capability-client';
import {
  voiceCapabilityReasonLabel,
  type VoiceCapabilityCheck,
} from './voice-capability';
import {
  createVoiceBrowserRuntime,
  type VoiceBrowserRuntime,
} from './voice-browser-runtime';
import { useDictation } from './dictation/use-dictation';
import { useVoiceSession } from './use-voice-session';
import { useLiveTranscriptionContinuity } from './use-live-transcription-continuity';
import { useLiveSpeechPlayback } from './playback/use-live-speech-playback';
import { isLikelyLivePlaybackEcho } from './playback/live-speech-echo';
import { LiveVoiceLaunchButton } from './live-voice-launch-button';
import {
  LiveVoicePanel,
  type LiveVoiceTranscriptEntry,
  type LiveVoiceVisualPhase,
} from './live-voice-panel';
import type { ChatMessageStatus } from '@/features/chat/messages';
import {
  freezeLiveVoiceContext,
  type LiveVoiceArtifactItem,
  type LiveVoiceCitationItem,
  type LiveVoiceContextAsset,
  type LiveVoiceContextSnapshot,
  type LiveVoiceToolItem,
} from './live-voice-context';
import {
  captureLiveVoiceEntry,
  reduceLiveVoiceThreshold,
  type LiveVoiceEntryCapture,
  type LiveVoiceThresholdEvent,
  type LiveVoiceThresholdPhase,
} from './live-voice-threshold';
import {
  assembleLiveVoiceExitPayload,
  type LiveVoiceAnnotationDraft,
  type LiveVoiceExitPayload,
} from './live-voice-bring-back';

type BaseComposerProps = Omit<
  ComponentProps<typeof Composer>,
  'voice' | 'value' | 'onValueChange'
>;

export interface VoiceComposerRuntimeProps extends BaseComposerProps {
  readonly notebookId: string;
  readonly capabilityChecks: readonly VoiceCapabilityCheck[];
  readonly runtime: VoiceBrowserRuntime;
  readonly capabilityLoading?: boolean;
  readonly liveAssistantId?: string | null;
  readonly liveAssistantText?: string | null;
  readonly liveAssistantStatus?: ChatMessageStatus | null;
  readonly liveTranscript?: readonly LiveVoiceTranscriptEntry[];
  readonly liveAssets?: readonly LiveVoiceContextAsset[];
  readonly liveArtifacts?: readonly LiveVoiceArtifactItem[];
  readonly liveCitations?: readonly LiveVoiceCitationItem[];
  readonly liveTools?: readonly LiveVoiceToolItem[];
  readonly onLiveToggleAsset?: (assetId: string) => void;
  readonly onLiveUploadAsset?: (
    file: File,
    kind: 'image' | 'document',
  ) => Promise<void>;
  readonly onLiveOpenAsset?: (assetId: string) => void;
  readonly onLiveOpenArtifact?: (artifactId: string) => void;
  readonly onLiveSend?: (
    text: string,
    context: LiveVoiceContextSnapshot,
  ) => void;
  /** 出室瞬间同步回调（EXIT 时触发，不等退场动画）：信笺等带回写库与动画并行。 */
  readonly onLiveExit?: (payload: LiveVoiceExitPayload) => void;
}

const LIVE_STATUS = {
  idle: '准备就绪',
  starting: '正在连接…',
  authorizing: '请允许麦克风访问',
  recording: '正在聆听',
  finalizing: '正在整理你的话…',
  stopped: '等待下一轮',
  cancelled: '已静音',
  failed: '连接中断',
} as const;

export function resolveLiveVoiceVisualPhase(input: {
  readonly muted: boolean;
  readonly busy: boolean;
  readonly preparing?: boolean;
  readonly recovering?: boolean;
  readonly speaking: boolean;
  readonly status: keyof typeof LIVE_STATUS;
}): LiveVoiceVisualPhase {
  if (input.muted) return 'muted';
  if (input.recovering) return 'connecting';
  if (input.status === 'failed') return 'error';
  if (input.speaking) return 'speaking';
  if (input.preparing) return 'thinking';
  if (input.busy) return 'thinking';
  if (input.status === 'starting' || input.status === 'authorizing') {
    return 'connecting';
  }
  if (input.status === 'recording' || input.status === 'finalizing')
    return 'listening';
  return 'idle';
}

export function mergeDictationTranscript(
  base: string,
  transcript: string,
): string {
  const existing = base.trimEnd();
  const text = transcript.trim();
  if (!text) return base;
  return existing ? `${existing} ${text}` : text;
}

/** 进入 Live 前已有的消息永远不属于本次会话，即使父级滑动窗口淘汰了锚点。 */
export function filterLiveSessionTranscript(
  transcript: readonly LiveVoiceTranscriptEntry[],
  baselineIds: readonly string[],
): readonly LiveVoiceTranscriptEntry[] {
  const baseline = new Set(baselineIds);
  return transcript.filter((entry) => !baseline.has(entry.id));
}

/** Dictation 与 Live Voice 共用 Composer 草稿，但只有 Dictation 能写入草稿。 */
export function VoiceComposerRuntime({
  notebookId,
  capabilityChecks,
  runtime,
  capabilityLoading = false,
  liveAssistantId = null,
  liveAssistantText = null,
  liveAssistantStatus = null,
  liveTranscript = [],
  liveAssets = [],
  liveArtifacts = [],
  liveCitations = [],
  liveTools = [],
  onLiveToggleAsset,
  onLiveUploadAsset,
  onLiveOpenAsset,
  onLiveOpenArtifact,
  onLiveSend,
  onLiveExit,
  ...composerProps
}: VoiceComposerRuntimeProps) {
  const { busy, onSend, onStop } = composerProps;
  const [draft, setDraft] = useState('');
  /* 门槛相位机取代 liveOpen 布尔：entering/exiting 期间面板已挂载但会话未开始。 */
  const [threshold, setThreshold] = useState<LiveVoiceThresholdPhase>('desk');
  const [entryCapture, setEntryCapture] =
    useState<LiveVoiceEntryCapture | null>(null);
  const [liveAnnotations, setLiveAnnotations] = useState<
    readonly LiveVoiceAnnotationDraft[]
  >([]);
  const liveOpen = threshold !== 'desk';
  const [muted, setMuted] = useState(false);
  const [liveTranscriptBaselineIds, setLiveTranscriptBaselineIds] = useState<
    readonly string[]
  >([]);
  const [liveContextSnapshot, setLiveContextSnapshot] =
    useState<LiveVoiceContextSnapshot | null>(null);
  const [activeDictation, setActiveDictation] = useState<
    'realtime' | 'batch' | null
  >(null);
  const liveLaunchButtonRef = useRef<HTMLButtonElement>(null);
  const pendingInterruptionRef = useRef<{
    readonly text: string;
    readonly context: LiveVoiceContextSnapshot;
  } | null>(null);
  const realtimeDictationBaseRef = useRef('');
  const appendDictation = useCallback((text: string) => {
    setDraft((current) => mergeDictationTranscript(current, text));
  }, []);
  const dictation = useDictation(appendDictation);

  const handleRealtimeDictationFinal = useCallback((text: string) => {
    setDraft(mergeDictationTranscript(realtimeDictationBaseRef.current, text));
  }, []);
  const realtimeDictation = useVoiceSession({
    notebookId,
    capabilityChecks,
    capabilityKind: 'transcription',
    createCapture: runtime.createCapture,
    createClient: runtime.createClient,
    onFinalText: handleRealtimeDictationFinal,
  });

  useEffect(() => {
    if (!realtimeDictation.partialText) return;
    setDraft(
      mergeDictationTranscript(
        realtimeDictationBaseRef.current,
        realtimeDictation.partialText,
      ),
    );
  }, [realtimeDictation.partialText]);

  /* 实时供应商短暂失败不能同时拖垮 Dictation：失败状态本身就是降级信号，
     无需再复制一份 React state；批量 ASR 可用时，本页后续录音直接走它。 */
  const realtimeDictationUnavailable =
    realtimeDictation.status === 'failed' && dictation.enabled;

  const speech = useLiveSpeechPlayback({
    enabled: liveOpen && !muted,
    assistantId: liveAssistantId,
    assistantText: liveAssistantText,
    assistantStatus: liveAssistantStatus,
  });
  const interruptSpeech = speech.interrupt;
  const cancelPendingSpeech = speech.cancelPending;
  const expectNextSpeechResponse = speech.expectNextResponse;
  const speechEchoRef = useRef({
    assistantText: liveAssistantText,
    assistantSubtitle: speech.subtitle,
    lastPlaybackAt: 0,
  });

  useEffect(() => {
    speechEchoRef.current.assistantText = liveAssistantText;
    speechEchoRef.current.assistantSubtitle = speech.subtitle;
    if (speech.speaking) speechEchoRef.current.lastPlaybackAt = Date.now();
  }, [liveAssistantText, speech.speaking, speech.subtitle]);

  const isPlaybackEcho = useCallback((text: string) => {
    const echo = speechEchoRef.current;
    return isLikelyLivePlaybackEcho({
      transcript: text,
      assistantText: echo.assistantText,
      assistantSubtitle: echo.assistantSubtitle,
      playbackRecentlyActive: Date.now() - echo.lastPlaybackAt <= 2_500,
    });
  }, []);

  const handleLiveFinal = useCallback(
    (text: string) => {
      if (isPlaybackEcho(text)) return;
      interruptSpeech();
      expectNextSpeechResponse();
      const context = freezeLiveVoiceContext(liveAssets);
      setLiveContextSnapshot(context);
      if (busy) {
        pendingInterruptionRef.current = { text, context };
        onStop?.();
        return;
      }
      if (onLiveSend) onLiveSend(text, context);
      else onSend(text);
    },
    [
      busy,
      expectNextSpeechResponse,
      interruptSpeech,
      isPlaybackEcho,
      liveAssets,
      onLiveSend,
      onSend,
      onStop,
    ],
  );
  const live = useVoiceSession({
    notebookId,
    capabilityChecks,
    createCapture: runtime.createLiveCapture ?? runtime.createCapture,
    createClient: runtime.createClient,
    onFinalText: handleLiveFinal,
  });
  const liveStart = live.start;
  const liveStop = live.stop;
  const liveCancel = live.cancel;
  const liveContinuity = useLiveTranscriptionContinuity({
    active: threshold === 'voice' && !muted,
    status: live.status,
    partialText: live.partialText,
    start: liveStart,
    stop: liveStop,
    cancel: liveCancel,
  });

  useEffect(() => {
    if (busy || pendingInterruptionRef.current === null) return;
    const pending = pendingInterruptionRef.current;
    pendingInterruptionRef.current = null;
    if (onLiveSend) onLiveSend(pending.text, pending.context);
    else onSend(pending.text);
  }, [busy, onLiveSend, onSend]);

  useEffect(() => {
    if (
      live.inputLevel >= 0.08 &&
      live.partialText.trim().length >= 2 &&
      !isPlaybackEcho(live.partialText)
    ) {
      cancelPendingSpeech();
    }
  }, [cancelPendingSpeech, isPlaybackEcho, live.inputLevel, live.partialText]);

  const realtimeDictationReady = realtimeDictation.capability.enabled;
  const useRealtimeDictation =
    !realtimeDictationUnavailable &&
    (activeDictation === 'realtime' ||
      (activeDictation === null && realtimeDictationReady));
  const selectedDictationStatus = useRealtimeDictation
    ? realtimeDictation.status
    : dictation.status;
  const dictationActive = [
    'starting',
    'authorizing',
    'recording',
    'finalizing',
  ].includes(selectedDictationStatus);
  const dictationVoice: ComposerVoiceControl = {
    enabled:
      (realtimeDictationReady || dictation.enabled) && !busy && !liveOpen,
    status: selectedDictationStatus,
    reason: realtimeDictationUnavailable
      ? dictation.status === 'failed' && dictation.reason
        ? dictation.reason
        : '实时识别暂不可用，已切换为录音后转写'
      : useRealtimeDictation && realtimeDictation.error
        ? '实时语音转文字失败，请重试'
        : useRealtimeDictation
          ? null
          : dictation.reason,
    onStart: () => {
      if (realtimeDictationReady && !realtimeDictationUnavailable) {
        setActiveDictation('realtime');
        realtimeDictationBaseRef.current = draft;
        realtimeDictation.start();
        return;
      }
      setActiveDictation('batch');
      dictation.start();
    },
    onStop: () => {
      if (activeDictation === 'realtime') {
        if (
          realtimeDictation.status === 'starting' ||
          realtimeDictation.status === 'authorizing'
        ) {
          realtimeDictation.cancel();
        } else {
          realtimeDictation.stop();
        }
        return;
      }
      dictation.stop();
    },
    onCancel: () => {
      if (activeDictation === 'realtime') {
        realtimeDictation.cancel();
        setDraft(realtimeDictationBaseRef.current);
        return;
      }
      dictation.cancel();
    },
  };
  const liveReason = capabilityLoading
    ? '正在检查 Live Voice 能力…'
    : live.capability.reason
      ? voiceCapabilityReasonLabel(live.capability.reason)
      : null;
  const liveVisualPhase = resolveLiveVoiceVisualPhase({
    muted,
    busy,
    preparing: speech.preparing,
    recovering: liveContinuity.recovering || liveContinuity.rotating,
    speaking: speech.speaking && !live.partialText,
    status: live.status,
  });
  const liveStatusLabel = speech.playbackFailed
    ? '语音播放暂时不可用，仍在聆听'
    : liveContinuity.rotating
      ? '正在保持连接…'
      : liveContinuity.recovering
        ? '正在恢复连接…'
        : speech.preparing
          ? '正在准备语音…'
          : liveVisualPhase === 'speaking'
            ? '正在回答'
            : liveVisualPhase === 'thinking'
              ? (composerProps.statusText ?? '正在思考…')
              : (liveReason ?? LIVE_STATUS[live.status]);
  const liveSessionTranscript = useMemo(
    () =>
      filterLiveSessionTranscript(liveTranscript, liveTranscriptBaselineIds),
    [liveTranscript, liveTranscriptBaselineIds],
  );
  const displayedLiveAssets = busy
    ? (liveContextSnapshot?.assets ?? liveAssets)
    : liveAssets;
  const applyThresholdEvent = useCallback((event: LiveVoiceThresholdEvent) => {
    setThreshold((current) => reduceLiveVoiceThreshold(current, event));
  }, []);

  /* 动效只能表现门槛，不能成为语音会话的唯一启停信号。后台标签页、GSAP
     context 被重建或浏览器丢失完成回调时，保底推进同一幂等相位事件。 */
  useEffect(() => {
    if (threshold !== 'entering' && threshold !== 'exiting') return undefined;
    const event = threshold === 'entering' ? 'ENTERED' : 'EXITED';
    const timer = window.setTimeout(() => applyThresholdEvent(event), 1_800);
    return () => window.clearTimeout(timer);
  }, [applyThresholdEvent, threshold]);
  const handleEntered = useCallback(
    () => applyThresholdEvent('ENTERED'),
    [applyThresholdEvent],
  );
  const handleExited = useCallback(
    () => applyThresholdEvent('EXITED'),
    [applyThresholdEvent],
  );

  /* 唯一收尾路径：相位回到 desk 时清理会话态、释放采集池并归还焦点；
     entering 取消与 exiting 动画完成殊途同归，都经这里。 */
  const prevThresholdRef = useRef<LiveVoiceThresholdPhase>('desk');
  useEffect(() => {
    const previous = prevThresholdRef.current;
    prevThresholdRef.current = threshold;
    if (threshold !== 'desk' || previous === 'desk') return;
    setLiveTranscriptBaselineIds([]);
    setLiveContextSnapshot(null);
    setEntryCapture(null);
    setLiveAnnotations([]);
    runtime.disposeLiveCapturePool?.();
    requestAnimationFrame(() => liveLaunchButtonRef.current?.focus());
  }, [threshold, runtime]);

  /* 出室：先停语音、同步组装带回 payload（信笺写库与退场动画并行、
     不在关键路径上等网络），再进入 exiting；动画完成由 onExited 收尾。 */
  const requestCloseLive = useCallback(() => {
    interruptSpeech();
    const payload = assembleLiveVoiceExitPayload({
      sessionTranscript: liveSessionTranscript,
      annotations: liveAnnotations,
    });
    if (payload) onLiveExit?.(payload);
    applyThresholdEvent('EXIT');
  }, [
    applyThresholdEvent,
    interruptSpeech,
    liveAnnotations,
    liveSessionTranscript,
    onLiveExit,
  ]);

  return (
    <>
      {composerProps.variant !== 'landing' ? (
        <div className="mx-auto mb-2 w-full max-w-3xl px-4">
          {liveOpen ? (
            <LiveVoicePanel
              phase={liveVisualPhase}
              statusLabel={liveStatusLabel}
              muted={muted}
              userSubtitle={live.partialText || null}
              assistantSubtitle={speech.subtitle}
              transcript={liveSessionTranscript}
              audioLevel={
                liveVisualPhase === 'speaking'
                  ? speech.outputLevel
                  : live.inputLevel
              }
              assets={displayedLiveAssets}
              artifacts={liveArtifacts}
              citations={liveCitations}
              tools={liveTools}
              annotations={liveAnnotations}
              onAnnotateAsset={(annotation) =>
                setLiveAnnotations((current) => [...current, annotation])
              }
              thresholdPhase={threshold}
              entryCapture={entryCapture}
              onEntered={handleEntered}
              onExited={handleExited}
              onToggleAsset={onLiveToggleAsset}
              onUploadAsset={onLiveUploadAsset}
              onOpenAsset={(assetId) => {
                requestCloseLive();
                onLiveOpenAsset?.(assetId);
              }}
              onOpenArtifact={(artifactId) => {
                requestCloseLive();
                onLiveOpenArtifact?.(artifactId);
              }}
              onToggleMute={() => {
                if (!muted) interruptSpeech();
                setMuted((value) => !value);
              }}
              onClose={requestCloseLive}
            />
          ) : (
            <LiveVoiceLaunchButton
              buttonRef={liveLaunchButtonRef}
              disabled={
                !live.capability.enabled || capabilityLoading || dictationActive
              }
              onClick={() => {
                speech.prepare();
                /* 同一帧冻结位置与数据：纸从案上哪里起飞，飞进茶室时就从哪里出发。 */
                setEntryCapture(
                  captureLiveVoiceEntry(liveLaunchButtonRef.current),
                );
                setLiveTranscriptBaselineIds(
                  liveTranscript.map((entry) => entry.id),
                );
                setLiveContextSnapshot(freezeLiveVoiceContext(liveAssets));
                setMuted(false);
                applyThresholdEvent('ENTER');
              }}
              title={liveReason ?? '开始 Live Voice'}
            />
          )}
        </div>
      ) : null}
      <Composer
        {...composerProps}
        value={draft}
        onValueChange={setDraft}
        voice={dictationVoice}
      />
    </>
  );
}

/** 生产组合：Live capability + 浏览器惰性 runtime；Dictation 有独立闸门。 */
export function VoiceComposer(
  props: BaseComposerProps & {
    readonly notebookId: string;
    readonly liveAssistantId?: string | null;
    readonly liveAssistantText?: string | null;
    readonly liveAssistantStatus?: ChatMessageStatus | null;
    readonly liveTranscript?: readonly LiveVoiceTranscriptEntry[];
    readonly liveAssets?: readonly LiveVoiceContextAsset[];
    readonly liveArtifacts?: readonly LiveVoiceArtifactItem[];
    readonly liveCitations?: readonly LiveVoiceCitationItem[];
    readonly liveTools?: readonly LiveVoiceToolItem[];
    readonly onLiveToggleAsset?: (assetId: string) => void;
    readonly onLiveUploadAsset?: (
      file: File,
      kind: 'image' | 'document',
    ) => Promise<void>;
    readonly onLiveOpenAsset?: (assetId: string) => void;
    readonly onLiveOpenArtifact?: (artifactId: string) => void;
    readonly onLiveSend?: (
      text: string,
      context: LiveVoiceContextSnapshot,
    ) => void;
    readonly onLiveExit?: (payload: LiveVoiceExitPayload) => void;
  },
) {
  const capability = useVoiceCapabilityQuery();
  const runtime = useMemo(
    () => createVoiceBrowserRuntime(capability.websocketUrl),
    [capability.websocketUrl],
  );
  return (
    <VoiceComposerRuntime
      {...props}
      capabilityChecks={capability.checks}
      capabilityLoading={capability.loading}
      runtime={runtime}
    />
  );
}
