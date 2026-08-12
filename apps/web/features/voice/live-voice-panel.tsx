'use client';

import { Microphone, MicrophoneSlash, X } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ChatMessageStatus } from '@/features/chat/messages';
import type { LiveVoiceVisualPhase } from './live-voice-motion';
import { useLiveVoiceMotion } from './use-live-voice-motion';
import { LiveVoiceOrb } from './live-voice-orb';
import type {
  LiveVoiceArtifactItem,
  LiveVoiceCitationItem,
  LiveVoiceContextAsset,
  LiveVoiceToolItem,
} from './live-voice-context';
import type {
  LiveVoiceEntryCapture,
  LiveVoiceThresholdPhase,
} from './live-voice-threshold';
import { LiveVoiceVisualStage } from './live-voice-visual-stage';
import type { LiveVoiceAnnotationDraft } from './live-voice-bring-back';
import {
  LiveVoiceAnswerReader,
  shouldShowLiveAnswerReader,
} from './live-voice-answer-reader';
import {
  LiveVoiceResourcePreview,
  type LiveVoicePreviewTarget,
} from './live-voice-resource-preview';
import './live-voice-panel.css';
import './live-voice-orb.css';

export type { LiveVoiceVisualPhase } from './live-voice-motion';

export interface LiveVoicePanelProps {
  readonly scopeKey?: string;
  readonly phase: LiveVoiceVisualPhase;
  readonly statusLabel: string;
  readonly muted: boolean;
  readonly userSubtitle: string | null;
  /** 同一 Turn 消息账本中的 Assistant 身份与增长文本；不由 TTS 状态派生。 */
  readonly assistantMessageId: string | null;
  readonly assistantText: string | null;
  readonly assistantStatus: ChatMessageStatus | null;
  /** 与实际 PCM 排期同步的当前可听 cue，不代表完整 Assistant 回答。 */
  readonly assistantSubtitle: string | null;
  readonly transcript?: readonly LiveVoiceTranscriptEntry[];
  readonly audioLevel?: number;
  readonly assets?: readonly LiveVoiceContextAsset[];
  readonly artifacts?: readonly LiveVoiceArtifactItem[];
  readonly citations?: readonly LiveVoiceCitationItem[];
  readonly tools?: readonly LiveVoiceToolItem[];
  readonly onToggleAsset?: (assetId: string) => void;
  readonly onUploadAsset?: (
    file: File,
    kind: 'image' | 'document',
  ) => Promise<void>;
  readonly annotations?: readonly LiveVoiceAnnotationDraft[];
  readonly onAnnotateAsset?: (draft: LiveVoiceAnnotationDraft) => void;
  readonly onToggleMute: () => void;
  readonly onClose: () => void;
  /** 门槛相位：面板在 entering/exiting 期间已挂载，转场编排据此推进。 */
  readonly thresholdPhase?: LiveVoiceThresholdPhase;
  /** 入室捕获（按钮与桌面语境纸的位置快照）；exiting 时用于 orb 归位。 */
  readonly entryCapture?: LiveVoiceEntryCapture | null;
  /** 入场时间线完成回调（reduced-motion 下挂载后即时触发）。 */
  readonly onEntered?: () => void;
  /** 退场时间线完成回调（reduced-motion 下即时触发）。 */
  readonly onExited?: () => void;
}

export interface LiveVoiceTranscriptEntry {
  readonly id: string;
  readonly speaker: '你' | 'AI';
  readonly text: string;
}

type LiveVoiceActiveTranscript = LiveVoiceTranscriptEntry;

export function toLiveVoiceDisplayText(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' 代码片段 ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_~`>|]/g, ' ')
    .replace(/\\theta/g, 'θ')
    .replace(/\\pi/g, 'π')
    .replace(/\\times/g, '×')
    .replace(/\\(?:boxed|frac|left|right|cos|sin|cdots)/g, ' ')
    .replace(/[{}\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 沉浸层不承担聊天记录浏览：用户 partial 优先；本轮 Assistant 消息开始增长后，
 * 直接显示本次可听 cue。PCM cue 由独立文本片段表达，完整回答仅保留在
 * 外层消息账本。
 */
export function resolveLiveVoiceActiveTranscript(input: {
  readonly phase: LiveVoiceVisualPhase;
  readonly userSubtitle: string | null;
  readonly assistantMessageId: string | null;
  readonly assistantText: string | null;
  readonly assistantStatus: ChatMessageStatus | null;
  readonly assistantSubtitle: string | null;
  readonly transcript: readonly LiveVoiceTranscriptEntry[];
}): LiveVoiceActiveTranscript | null {
  const userSubtitle = input.userSubtitle
    ? toLiveVoiceDisplayText(input.userSubtitle)
    : '';
  if (userSubtitle) {
    return {
      id: 'live-partial-current',
      speaker: '你',
      text: userSubtitle,
    };
  }

  const assistantSubtitle = input.assistantSubtitle
    ? toLiveVoiceDisplayText(input.assistantSubtitle)
    : '';

  if (input.phase === 'speaking' && assistantSubtitle) {
    return {
      id: `live-assistant:${input.assistantMessageId ?? 'current'}`,
      speaker: 'AI',
      text: assistantSubtitle,
    };
  }

  if (
    input.phase !== 'thinking' &&
    input.phase !== 'connecting' &&
    input.phase !== 'error'
  ) {
    return null;
  }

  const latestUserEntry = [...input.transcript]
    .reverse()
    .find((entry) => entry.speaker === '你' && entry.text.trim().length > 0);
  if (!latestUserEntry) return null;
  const text = toLiveVoiceDisplayText(latestUserEntry.text);
  return text
    ? {
        id: latestUserEntry.id,
        speaker: latestUserEntry.speaker,
        text,
      }
    : null;
}

/**
 * Live Voice 的视觉层只消费归一化状态，不参与录音、Turn 或播放控制。
 * MorphSVG 表达能量变化，字幕与状态文字仍是唯一的信息承载层。
 */
export function LiveVoicePanel({
  scopeKey = 'live-preview',
  phase,
  statusLabel,
  muted,
  userSubtitle,
  assistantMessageId,
  assistantText,
  assistantStatus,
  assistantSubtitle,
  transcript = [],
  audioLevel = 0,
  assets = [],
  artifacts = [],
  citations = [],
  tools = [],
  onToggleAsset,
  onUploadAsset,
  annotations = [],
  onAnnotateAsset,
  onToggleMute,
  onClose,
  thresholdPhase,
  entryCapture = null,
  onEntered,
  onExited,
}: LiveVoicePanelProps) {
  const rootRef = useRef<HTMLDialogElement>(null);
  const [previewTarget, setPreviewTarget] =
    useState<LiveVoicePreviewTarget | null>(null);
  const previewTriggerRef = useRef<HTMLButtonElement | null>(null);
  const closePreview = () => {
    setPreviewTarget(null);
    requestAnimationFrame(() => previewTriggerRef.current?.focus());
  };
  const activeTranscript = resolveLiveVoiceActiveTranscript({
    phase,
    userSubtitle,
    assistantMessageId,
    assistantText,
    assistantStatus,
    assistantSubtitle,
    transcript,
  });
  const audibleCue =
    phase === 'speaking' && assistantSubtitle
      ? toLiveVoiceDisplayText(assistantSubtitle)
      : '';
  const showAnswerReader = shouldShowLiveAnswerReader(assistantText);
  useLiveVoiceMotion(
    rootRef,
    phase,
    activeTranscript?.id ?? `live-hint-${muted ? 'muted' : phase}`,
    audioLevel,
    {
      thresholdPhase: thresholdPhase ?? 'voice',
      entryCapture,
      onEntered,
      onExited,
    },
  );

  useEffect(() => {
    const dialog = rootRef.current;
    if (!dialog) return;
    const previousFocus = document.activeElement;
    if (!dialog.open) dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  }, []);

  const content = (
    <dialog
      ref={rootRef}
      aria-label="Live Voice"
      aria-modal="true"
      className="live-voice-modal"
      onCancel={(event) => {
        event.preventDefault();
        if (previewTarget) {
          closePreview();
          return;
        }
        onClose();
      }}
    >
      <section
        data-live-stage
        data-phase={phase}
        data-has-visual={
          assets.length > 0 || artifacts.length > 0 || tools.length > 0
            ? 'true'
            : 'false'
        }
        data-has-content={
          previewTarget !== null || showAnswerReader ? 'true' : 'false'
        }
        className="live-voice-stage"
      >
        <div data-live-copy className="live-voice-copy">
          <p className="live-voice-eyebrow">Live Voice</p>
          <p
            data-live-status-copy
            aria-live="polite"
            className="live-voice-status"
          >
            <span data-live-status-dot aria-hidden="true" />
            {statusLabel}
          </p>
        </div>

        <div className="live-voice-experience">
          <div className="live-voice-orb-column">
            <LiveVoiceOrb />
            <div data-live-copy className="live-voice-transcript-deck">
              <div
                data-live-active-line
                data-speaker={activeTranscript?.speaker ?? 'system'}
                aria-live="polite"
                className="live-voice-active-transcript"
              >
                {activeTranscript ? (
                  <p>
                    <span>{activeTranscript.speaker}</span>
                    {activeTranscript.text}
                  </p>
                ) : (
                  <p>{muted ? '点按麦克风继续' : phaseHint(phase)}</p>
                )}
              </div>
              {audibleCue ? (
                <p data-live-audible-cue className="live-voice-audible-cue">
                  <span>正在播放</span>
                  {audibleCue}
                </p>
              ) : null}
            </div>
          </div>

          <div className="live-voice-content-column">
            {previewTarget ? (
              <LiveVoiceResourcePreview
                key={`${scopeKey}:${previewTarget.kind}:${previewTarget.id}`}
                target={previewTarget}
                scopeKey={scopeKey}
                onClose={closePreview}
              />
            ) : null}
            {showAnswerReader && assistantText ? (
              <LiveVoiceAnswerReader
                key={assistantMessageId ?? 'live-answer'}
                text={assistantText}
                streaming={assistantStatus === 'streaming'}
                hidden={previewTarget !== null}
              />
            ) : null}
            <LiveVoiceVisualStage
              assets={assets}
              artifacts={artifacts}
              citations={citations}
              tools={tools}
              onToggleAsset={onToggleAsset}
              onUploadAsset={onUploadAsset}
              onOpenAsset={(assetId, title, trigger) => {
                previewTriggerRef.current = trigger;
                setPreviewTarget({ kind: 'source', id: assetId, title });
              }}
              onOpenArtifact={(artifactId, title, trigger) => {
                previewTriggerRef.current = trigger;
                setPreviewTarget({ kind: 'artifact', id: artifactId, title });
              }}
              annotations={annotations}
              onAnnotateAsset={onAnnotateAsset}
            />
          </div>
        </div>

        <div data-live-controls className="live-voice-controls">
          <button
            type="button"
            onClick={onToggleMute}
            aria-label={muted ? '继续聆听' : '暂停聆听'}
            aria-pressed={muted}
            className="live-voice-round-button"
          >
            {muted ? (
              <MicrophoneSlash size={22} />
            ) : (
              <Microphone size={22} weight="fill" />
            )}
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="结束 Live Voice"
            className="live-voice-round-button live-voice-close-button"
          >
            <X size={23} />
          </button>
        </div>
      </section>
    </dialog>
  );

  return typeof document === 'undefined'
    ? content
    : createPortal(content, document.body);
}

function phaseHint(phase: LiveVoiceVisualPhase): string {
  if (phase === 'connecting') return '正在建立语音连接';
  if (phase === 'thinking') return '正在思考';
  if (phase === 'speaking') return '正在回答 · 随时可以插话';
  if (phase === 'error') return '连接中断，请结束后重试';
  if (phase === 'idle') return '准备好了，说点什么吧';
  return '我在听';
}
