'use client';

import { Headphones } from '@phosphor-icons/react';
import type { AudioOverviewMedia } from './artifact-client';

export function AudioOverviewPlayer({
  media,
}: {
  media: AudioOverviewMedia;
}) {
  return (
    <section
      data-audio-overview
      className="mx-auto flex w-full max-w-2xl flex-col gap-5 rounded-3xl border border-line bg-surface/80 p-5 shadow-[var(--shadow-float)] sm:p-7"
    >
      <div className="flex items-center gap-3">
        <span className="grid size-11 place-items-center rounded-2xl bg-accent-soft text-accent">
          <Headphones aria-hidden="true" size={23} />
        </span>
        <span>
          <span className="block text-sm font-semibold text-ink">音频概览</span>
          <span className="block text-xs text-ink-muted">
            基于 {media.sourceCount} 项来源 · AI 合成语音
          </span>
        </span>
      </div>
      <audio
        controls
        preload="metadata"
        src={media.url}
        className="w-full"
        aria-label="播放音频概览"
      >
        你的浏览器不支持音频播放。
      </audio>
      <details className="rounded-2xl bg-surface-strong/65 px-4 py-3">
        <summary className="cursor-pointer text-sm font-medium text-ink">
          查看文字稿
        </summary>
        <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-ink-muted">
          {media.transcript}
        </p>
      </details>
    </section>
  );
}
