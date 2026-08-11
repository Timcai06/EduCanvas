'use client';

import { Microphone, MicrophoneSlash, X } from '@phosphor-icons/react';
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { LiveVoiceVisualPhase } from './live-voice-motion';
import { useLiveVoiceMotion } from './use-live-voice-motion';
import { LiveVoiceOrb } from './live-voice-orb';
import type {
  LiveVoiceArtifactItem,
  LiveVoiceCitationItem,
  LiveVoiceContextAsset,
  LiveVoiceToolItem,
} from './live-voice-context';
import { LiveVoiceVisualStage } from './live-voice-visual-stage';
import './live-voice-panel.css';
import './live-voice-orb.css';

export type { LiveVoiceVisualPhase } from './live-voice-motion';

export interface LiveVoicePanelProps {
  readonly phase: LiveVoiceVisualPhase;
  readonly statusLabel: string;
  readonly muted: boolean;
  readonly userSubtitle: string | null;
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
  readonly onOpenAsset?: (assetId: string) => void;
  readonly onOpenArtifact?: (artifactId: string) => void;
  readonly onToggleMute: () => void;
  readonly onClose: () => void;
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
 * 沉浸层不承担聊天记录浏览：只显示正在识别的用户话语、思考中的本轮问题，
 * 或与 Web Audio 播放时钟同步的 Assistant cue。
 */
export function resolveLiveVoiceActiveTranscript(input: {
  readonly phase: LiveVoiceVisualPhase;
  readonly userSubtitle: string | null;
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
      id: 'live-speaking-current',
      speaker: 'AI',
      text: assistantSubtitle,
    };
  }

  if (input.phase !== 'thinking') return null;
  const latestUserEntry = [...input.transcript]
    .reverse()
    .find((entry) => entry.speaker === '你' && entry.text.trim().length > 0);
  if (!latestUserEntry) return null;
  const text = toLiveVoiceDisplayText(latestUserEntry.text);
  return text ? { ...latestUserEntry, text } : null;
}

/**
 * Live Voice 的视觉层只消费归一化状态，不参与录音、Turn 或播放控制。
 * MorphSVG 表达能量变化，字幕与状态文字仍是唯一的信息承载层。
 */
export function LiveVoicePanel({
  phase,
  statusLabel,
  muted,
  userSubtitle,
  assistantSubtitle,
  transcript = [],
  audioLevel = 0,
  assets = [],
  artifacts = [],
  citations = [],
  tools = [],
  onToggleAsset,
  onUploadAsset,
  onOpenAsset,
  onOpenArtifact,
  onToggleMute,
  onClose,
}: LiveVoicePanelProps) {
  const rootRef = useRef<HTMLDialogElement>(null);
  const activeTranscript = resolveLiveVoiceActiveTranscript({
    phase,
    userSubtitle,
    assistantSubtitle,
    transcript,
  });
  useLiveVoiceMotion(
    rootRef,
    phase,
    activeTranscript?.id ?? `live-hint-${muted ? 'muted' : phase}`,
    audioLevel,
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
        className="live-voice-stage"
      >
        <div
          data-live-field-layer
          aria-hidden="true"
          className="live-voice-field"
        >
          <i data-live-field="a" />
          <i data-live-field="b" />
          <i data-live-field="c" />
          <i data-live-field="d" />
        </div>
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

        <LiveVoiceOrb />

        <LiveVoiceVisualStage
          assets={assets}
          artifacts={artifacts}
          citations={citations}
          tools={tools}
          onToggleAsset={onToggleAsset}
          onUploadAsset={onUploadAsset}
          onOpenAsset={onOpenAsset}
          onOpenArtifact={onOpenArtifact}
        />

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
