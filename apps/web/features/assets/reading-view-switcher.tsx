'use client';

import { X } from '@phosphor-icons/react';
import { MessageMarkdown } from '@/features/chat/markdown';
import { useState, type ReactNode } from 'react';

/**
 * ADR-0026 决定 6 的文本派生表示形状（pdf/docx 契约同构）。
 * quality 四态 + producer 标注；unavailable 兼容旧响应。
 */
export type ReadingRepresentation =
  | {
      quality?:
        | 'structured'
        | 'degraded_plain_text'
        | 'processing'
        | 'failed'
        | 'unavailable'
        | null;
      markdown?: string | null;
      producer?: string | null;
      producerVersion?: string | null;
    }
  | null
  | undefined;

export type ReadingQuality = NonNullable<ReadingRepresentation>['quality'];

/** 四态质量 → 阅读入口决策：structured/degraded 有派生文本可读，其余只提示。 */
export function resolveReadingAvailability(
  representation: ReadingRepresentation,
): {
  readable: boolean;
  /** 可读时必为派生文本（structured 或 degraded 产物），否则为 null。 */
  markdown: string | null;
  degraded: boolean;
  producerLabel: string;
  producerVersion: string | null;
} {
  const quality = representation?.quality;
  const markdown = representation?.markdown ?? null;
  const readable =
    markdown !== null &&
    (quality === 'structured' || quality === 'degraded_plain_text');
  return {
    readable,
    markdown: readable ? markdown : null,
    degraded: quality === 'degraded_plain_text',
    producerLabel:
      representation?.producer === 'mineru'
        ? 'MinerU'
        : representation?.producer === 'default'
          ? '内置文本提取'
          : (representation?.producer ?? '未知来源'),
    producerVersion: representation?.producerVersion ?? null,
  };
}

/** 质量提示文案与色调：只返回一行说明，视觉由浮层胶囊统一承载。 */
export function resolveQualityNote(
  representation: ReadingRepresentation,
): { text: string; tone: 'info' | 'error' } | null {
  switch (representation?.quality) {
    case 'processing':
      return {
        text: '文档转换处理中，完成后可切换到结构化阅读。',
        tone: 'info',
      };
    case 'failed':
      return { text: '结构化转换失败；仍可预览原件。', tone: 'error' };
    case 'degraded_plain_text':
      return {
        text: '结构化转换当前不可用，已降级为纯文本；原件保留。',
        tone: 'info',
      };
    case 'unavailable':
      return { text: '结构化内容暂不可用；仍可查看原件。', tone: 'info' };
    default:
      return null;
  }
}

/**
 * 原件/结构化阅读切换壳（ADR-0026 决定 6）。原件视图始终是默认视图，
 * 结构化/降级文本派生可用时提供显式切换，不默认用派生 Markdown 顶替原件
 * renderer。structured 与 degraded_plain_text 在切换标签与标注上严格区分
 * （降级结果绝不标成 structured）。initialView 仅供测试注入结构化视图的
 * 静态渲染；真实交互从原件视图开始。
 *
 * 质量提示是文档流外的底部浮动胶囊：不占原件可视高度、不随内容滚动，
 * 可手动关闭；quality 变化时重新出现。
 */
export function ReadingViewSwitcher({
  representation,
  renderOriginal,
  initialView = 'original',
}: {
  representation: ReadingRepresentation;
  /** 原件视图内容（pdf.js / mammoth 预览或占位说明）。 */
  renderOriginal: () => ReactNode;
  initialView?: 'original' | 'structured';
}) {
  const [view, setView] = useState<'original' | 'structured'>(initialView);
  /* 记录被关闭提示对应的 quality：按值记忆，quality 变为其他值后重新出现，
     回到同一值时保持关闭（用户已看过该状态）。 */
  const [dismissedQuality, setDismissedQuality] =
    useState<ReadingQuality | null>(null);
  const availability = resolveReadingAvailability(representation);
  const readableMarkdown = availability.markdown;
  const qualityNote = resolveQualityNote(representation);
  const noteDismissed = dismissedQuality === representation?.quality;

  if (view === 'structured' && readableMarkdown) {
    const degraded = availability.degraded;
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4">
          <p className="text-xs font-medium text-ink-muted">
            {degraded
              ? `纯文本降级 · ${availability.producerLabel}`
              : `结构化阅读 · ${availability.producerLabel}`}
            {availability.producerVersion
              ? ` ${availability.producerVersion}`
              : ''}{' '}
            · 派生表示
          </p>
          <button
            type="button"
            onClick={() => setView('original')}
            className="rounded-full border border-line px-3 py-1 text-xs font-medium text-ink transition-colors hover:bg-surface-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            返回原件预览
          </button>
        </div>
        <article className="mx-auto max-w-3xl rounded-2xl bg-card p-5 shadow-[var(--shadow-float)]">
          <MessageMarkdown text={readableMarkdown} />
        </article>
      </div>
    );
  }

  return (
    <div className="relative flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 px-4 py-3">
        <p className="text-xs text-ink-muted">原件预览</p>
        {readableMarkdown ? (
          <div
            role="group"
            aria-label="阅读视图切换"
            className="inline-flex rounded-full border border-line bg-card p-0.5"
          >
            <button
              type="button"
              aria-pressed={view === 'original'}
              onClick={() => setView('original')}
              className="rounded-full px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent aria-pressed:bg-surface-strong aria-pressed:text-ink"
            >
              原件预览
            </button>
            <button
              type="button"
              aria-pressed={view === 'structured'}
              onClick={() => setView('structured')}
              className="rounded-full px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent aria-pressed:bg-surface-strong aria-pressed:text-ink"
            >
              {availability.degraded ? '纯文本降级' : '结构化阅读'}
            </button>
          </div>
        ) : null}
      </div>
      <div className="min-h-0 flex-1">{renderOriginal()}</div>
      {qualityNote && !noteDismissed ? (
        <div className="pointer-events-none absolute bottom-4 left-1/2 z-10 w-max max-w-[calc(100%-2rem)] -translate-x-1/2">
          <div
            role="status"
            className={`pointer-events-auto flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs shadow-[var(--shadow-float)] backdrop-blur-md ${
              qualityNote.tone === 'error'
                ? 'border-cinnabar/25 bg-cinnabar-soft text-cinnabar'
                : 'border-line bg-card/95 text-ink-muted'
            }`}
          >
            <span className="min-w-0">{qualityNote.text}</span>
            <button
              type="button"
              aria-label="关闭提示"
              onClick={() =>
                setDismissedQuality(representation?.quality ?? null)
              }
              className="shrink-0 rounded-full p-0.5 transition-colors hover:bg-surface-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <X aria-hidden="true" size={12} />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
