'use client';

import {
  ArrowRight,
  Cards,
  Headphones,
  Image,
  Note,
  PresentationChart,
  TreeStructure,
} from '@phosphor-icons/react';
import type { ComponentType } from 'react';
import type { MessageArtifactDTO } from './messages';

const KIND_PRESENTATION: Record<
  string,
  { label: string; icon: ComponentType<{ size?: number; weight?: 'regular' }> }
> = {
  mind_map: { label: '思维导图', icon: TreeStructure },
  slides: { label: 'Slides', icon: PresentationChart },
  flashcards: { label: '闪卡', icon: Cards },
  audio_overview: { label: '音频概览', icon: Headphones },
  generated_image: { label: '生成图片', icon: Image },
  note: { label: '笔记', icon: Note },
};

/**
 * 对话内产物入口只负责重开同一 Artifact；详情、版本和生成状态仍由 Canvas
 * 按点击时的服务端事实读取，因此卡片不会成为 Studio 之外的第二份产物状态。
 */
export function ConversationArtifactCard({
  artifact,
  onOpen,
}: {
  artifact: MessageArtifactDTO;
  onOpen: (artifactId: string) => void;
}) {
  const presentation = KIND_PRESENTATION[artifact.kind] ?? {
    label: 'Canvas 产物',
    icon: PresentationChart,
  };
  const Icon = presentation.icon;

  return (
    <button
      type="button"
      onClick={() => onOpen(artifact.id)}
      aria-label={`打开产物：${artifact.title}`}
      className="group flex w-full max-w-sm items-center gap-3 rounded-2xl border border-line bg-card p-3 text-left shadow-[var(--shadow-float)] transition-[border-color,transform] hover:-translate-y-0.5 hover:border-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
    >
      <span
        aria-hidden="true"
        className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent"
      >
        <Icon size={21} weight="regular" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-display text-sm font-semibold text-ink">
          {artifact.title}
        </span>
        <span className="block text-xs text-ink-muted">
          {presentation.label}
          {artifact.latestVersion > 0
            ? ` · v${artifact.latestVersion}`
            : artifact.status === 'failed'
              ? ' · 生成失败'
              : ' · 正在生成'}
        </span>
      </span>
      <span className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-accent">
        打开
        <ArrowRight
          aria-hidden="true"
          size={14}
          weight="bold"
          className="transition-transform group-hover:translate-x-0.5"
        />
      </span>
    </button>
  );
}
