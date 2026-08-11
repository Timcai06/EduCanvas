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
import { useLiveSpeechPlayback } from './playback/use-live-speech-playback';
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
  readonly speaking: boolean;
  readonly status: keyof typeof LIVE_STATUS;
}): LiveVoiceVisualPhase {
  if (input.muted) return 'muted';
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
  ...composerProps
}: VoiceComposerRuntimeProps) {
  const { busy, onSend, onStop } = composerProps;
  const [draft, setDraft] = useState('');
  const [liveOpen, setLiveOpen] = useState(false);
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

  const speech = useLiveSpeechPlayback({
    enabled: liveOpen && !muted,
    assistantId: liveAssistantId,
    assistantText: liveAssistantText,
    assistantStatus: liveAssistantStatus,
  });
  const interruptSpeech = speech.interrupt;
  const cancelPendingSpeech = speech.cancelPending;

  const handleLiveFinal = useCallback(
    (text: string) => {
      interruptSpeech();
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
    [busy, interruptSpeech, liveAssets, onLiveSend, onSend, onStop],
  );
  const live = useVoiceSession({
    notebookId,
    capabilityChecks,
    createCapture: runtime.createLiveCapture ?? runtime.createCapture,
    createClient: runtime.createClient,
    onFinalText: handleLiveFinal,
  });
  const liveStart = live.start;
  const liveCancel = live.cancel;

  useEffect(() => {
    if (!liveOpen || muted) {
      liveCancel();
      return;
    }
    if (
      live.status === 'idle' ||
      live.status === 'stopped' ||
      live.status === 'cancelled'
    ) {
      liveStart();
    }
  }, [live.status, liveCancel, liveOpen, liveStart, muted]);

  useEffect(() => {
    if (busy || pendingInterruptionRef.current === null) return;
    const pending = pendingInterruptionRef.current;
    pendingInterruptionRef.current = null;
    if (onLiveSend) onLiveSend(pending.text, pending.context);
    else onSend(pending.text);
  }, [busy, onLiveSend, onSend]);

  useEffect(() => {
    if (live.inputLevel >= 0.08 && live.partialText.trim().length >= 2) {
      cancelPendingSpeech();
    }
  }, [cancelPendingSpeech, live.inputLevel, live.partialText]);

  const realtimeDictationReady = realtimeDictation.capability.enabled;
  const useRealtimeDictation =
    activeDictation === 'realtime' ||
    (activeDictation === null && realtimeDictationReady);
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
    reason:
      useRealtimeDictation && realtimeDictation.error
        ? '实时语音转文字失败，请重试'
        : useRealtimeDictation
          ? null
          : dictation.reason,
    onStart: () => {
      if (realtimeDictationReady) {
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
    speaking: speech.speaking && !live.partialText,
    status: live.status,
  });
  const liveStatusLabel = speech.playbackFailed
    ? '语音播放暂时不可用，仍在聆听'
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
  const closeLive = useCallback(() => {
    interruptSpeech();
    setLiveOpen(false);
    setLiveTranscriptBaselineIds([]);
    setLiveContextSnapshot(null);
    runtime.disposeLiveCapturePool?.();
    requestAnimationFrame(() => liveLaunchButtonRef.current?.focus());
  }, [interruptSpeech, runtime]);

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
              onToggleAsset={onLiveToggleAsset}
              onUploadAsset={onLiveUploadAsset}
              onOpenAsset={(assetId) => {
                closeLive();
                onLiveOpenAsset?.(assetId);
              }}
              onOpenArtifact={(artifactId) => {
                closeLive();
                onLiveOpenArtifact?.(artifactId);
              }}
              onToggleMute={() => {
                if (!muted) interruptSpeech();
                setMuted((value) => !value);
              }}
              onClose={closeLive}
            />
          ) : (
            <LiveVoiceLaunchButton
              buttonRef={liveLaunchButtonRef}
              disabled={
                !live.capability.enabled || capabilityLoading || dictationActive
              }
              onClick={() => {
                speech.prepare();
                setLiveTranscriptBaselineIds(
                  liveTranscript.map((entry) => entry.id),
                );
                setLiveContextSnapshot(freezeLiveVoiceContext(liveAssets));
                setMuted(false);
                setLiveOpen(true);
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
