'use client';

import {
  Cards,
  Headphones,
  PresentationChart,
  TreeStructure,
  type Icon,
} from '@phosphor-icons/react';
import type { ArtifactDetail } from './artifact-client';
import { isArtifactGenerating } from './artifact-provenance-model';

export { isArtifactGenerating };

/**
 * Canvas 溯源条：让产物"从对话中生长出来"这件事被看见。
 * 交代三件事——它是什么、从哪来、当前状态；不编造触发问题，只呈现可信事实
 * （由本笔记本对话生成、最近生成任务的真实状态）。设计依据见
 * docs/01-product/student-ui-spec.md「Canvas 溯源」。
 */

const KIND_META: Record<string, { label: string; Icon: Icon }> = {
  mind_map: { label: '思维导图', Icon: TreeStructure },
  slides: { label: 'Slides', Icon: PresentationChart },
  flashcards: { label: '闪卡', Icon: Cards },
  audio_overview: { label: '音频概览', Icon: Headphones },
};

function formatUpdatedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const sameDay = date.toDateString() === new Date().toDateString();
  return sameDay
    ? `更新于 ${date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
    : `更新于 ${date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}`;
}

export function ArtifactProvenanceStrip({
  detail,
  revising,
}: {
  detail: ArtifactDetail;
  revising: boolean;
}) {
  const meta = KIND_META[detail.artifact.kind] ?? {
    label: '产物',
    Icon: TreeStructure,
  };
  const generating = isArtifactGenerating(detail, revising);
  const failed = !generating && detail.latestJob?.status === 'failed';

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-line bg-surface/50 px-4 py-2 text-xs">
      <span className="inline-flex items-center gap-1.5 font-medium text-ink-muted">
        <meta.Icon aria-hidden="true" size={14} className="text-accent" />
        {meta.label}
      </span>
      {detail.artifact.fromConversation ? (
        <span className="text-ink-faint">· 由本对话生成</span>
      ) : null}
      {detail.version?.media && detail.version.media.sourceCount > 0 ? (
        <span className="text-ink-faint">
          · 引用 {detail.version.media.sourceCount} 个来源
        </span>
      ) : null}
      <span className="flex-1" />
      {generating ? (
        <span
          role="status"
          className="inline-flex items-center gap-1.5 font-medium text-accent"
        >
          <span
            aria-hidden="true"
            className="size-1.5 animate-pulse rounded-full bg-accent motion-reduce:animate-none"
          />
          {revising ? '正在生成新版本…' : '正在生成…'}
          {detail.latestJob?.progress != null && detail.latestJob.progress > 0 ? (
            <span className="tabular-nums text-ink-faint">
              {detail.latestJob.progress}%
            </span>
          ) : null}
        </span>
      ) : failed ? (
        <span className="inline-flex items-center gap-1.5 font-medium text-bad">
          <span aria-hidden="true" className="size-1.5 rounded-full bg-bad" />
          生成失败
        </span>
      ) : (
        <span className="text-ink-faint">
          {formatUpdatedAt(detail.artifact.updatedAt)}
        </span>
      )}
    </div>
  );
}

/**
 * 生成中骨架：产物尚无可显示版本时，用"正在从对话中生成"的墨条呼吸替代
 * 冷冰冰的"还没有版本"，让等待也是活的。reduced-motion 下静态呈现。
 */
export function ArtifactGeneratingSkeleton() {
  return (
    <div
      role="status"
      aria-label="正在生成产物"
      className="mx-auto flex max-w-md flex-col gap-3 py-8"
    >
      <p className="text-center text-sm text-ink-muted">
        正在从这段对话里生成内容…
      </p>
      <div className="space-y-2.5">
        {[92, 78, 64, 84, 50].map((width, index) => (
          <div
            key={width}
            className="h-3 animate-pulse rounded-full bg-surface-strong motion-reduce:animate-none"
            style={{ width: `${width}%`, animationDelay: `${index * 0.12}s` }}
          />
        ))}
      </div>
    </div>
  );
}
