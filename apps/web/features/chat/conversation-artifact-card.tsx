'use client';

import { useGSAP } from '@gsap/react';
import {
  ArrowRight,
  Cards,
  CircleNotch,
  Headphones,
  Image,
  Note,
  PresentationChart,
  TreeStructure,
} from '@phosphor-icons/react';
import gsap from 'gsap';
import { useRef, type ComponentType } from 'react';
import { motionDuration } from '@/features/theme/motion';
import type { MessageArtifactDTO } from './messages';

gsap.registerPlugin(useGSAP);

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

/** 服务端进度是 job 内部值，展示前夹到 0-100 避免异常值破坏进度条。 */
export function clampProgress(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)));
}

/**
 * 对话内产物入口只负责重开同一 Artifact；详情、版本和生成状态仍由 Canvas
 * 按点击时的服务端事实读取，因此卡片不会成为 Studio 之外的第二份产物状态。
 *
 * 生成中（proposed）显示 spinner 与进度条，进度来自 artifact.generation_progress
 * 事件；生成完成（proposed→active）播放一次图标脉冲，不做循环动画。
 */
export function ConversationArtifactCard({
  artifact,
  onOpen,
}: {
  artifact: MessageArtifactDTO;
  onOpen: (artifactId: string) => void;
}) {
  const iconRef = useRef<HTMLSpanElement>(null);
  const previousStatusRef = useRef(artifact.status);
  const presentation = KIND_PRESENTATION[artifact.kind] ?? {
    label: 'Canvas 产物',
    icon: PresentationChart,
  };
  const Icon = presentation.icon;
  const generating = artifact.status === 'proposed';
  const failed = artifact.status === 'failed' || artifact.status === 'cancelled';
  const progress =
    artifact.progress !== undefined ? clampProgress(artifact.progress) : null;
  const detail =
    artifact.latestVersion > 0
      ? `v${artifact.latestVersion}`
      : artifact.status === 'failed'
        ? '生成失败'
        : artifact.status === 'cancelled'
          ? '已取消'
          : progress !== null
            ? `生成中 ${progress}%`
            : '正在生成';

  useGSAP(
    () => {
      const previous = previousStatusRef.current;
      previousStatusRef.current = artifact.status;
      if (previous !== 'proposed' || artifact.status !== 'active') return;
      if (!iconRef.current) return;
      const media = gsap.matchMedia();
      media.add('(prefers-reduced-motion: no-preference)', () => {
        gsap.fromTo(
          iconRef.current,
          { scale: 0.85 },
          {
            scale: 1,
            duration: motionDuration('fast'),
            ease: 'back.out(2)',
            clearProps: 'transform',
          },
        );
      });
      return () => media.revert();
    },
    { scope: iconRef, dependencies: [artifact.status] },
  );

  return (
    <button
      type="button"
      onClick={() => onOpen(artifact.id)}
      aria-label={`打开产物：${artifact.title}`}
      className="group flex w-full max-w-sm items-center gap-3 rounded-2xl border border-line bg-card p-3 text-left shadow-[var(--shadow-float)] transition-[border-color,transform] hover:-translate-y-0.5 hover:border-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
    >
      <span
        ref={iconRef}
        aria-hidden="true"
        className={`grid size-10 shrink-0 place-items-center rounded-xl ${
          failed
            ? 'bg-danger-soft text-danger'
            : generating
              ? 'bg-surface-strong text-accent'
              : 'bg-accent-soft text-accent'
        }`}
      >
        {generating ? (
          <CircleNotch size={21} weight="bold" className="animate-spin" />
        ) : (
          <Icon size={21} weight="regular" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-display text-sm font-semibold text-ink">
          {artifact.title}
        </span>
        <span className="block text-xs text-ink-muted">
          {presentation.label} · {detail}
        </span>
        {generating && progress !== null ? (
          <span
            className="mt-1.5 block h-1 w-full overflow-hidden rounded-full bg-surface-strong"
            role="progressbar"
            aria-label={`${artifact.title} 生成进度`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress}
          >
            <span
              className="block h-full rounded-full bg-accent transition-[width] duration-500"
              style={{ width: `${progress}%` }}
            />
          </span>
        ) : null}
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
