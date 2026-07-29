'use client';

/**
 * 音频概览播放器与文字稿。文字稿始终可独立阅读，
 * 即使音频播放失败也不受影响。非 Web 消费者通过
 * buildAudioSummary 获得有界文本等价。
 */

import { Headphones } from '@phosphor-icons/react';
import { useCallback, useState } from 'react';
import type { AudioOverviewMedia } from './artifact-client';

export function AudioOverviewPlayer({
  media,
  allowedActions,
}: {
  media: AudioOverviewMedia;
  allowedActions?: readonly string[];
}) {
  const [playbackFailed, setPlaybackFailed] = useState(false);
  const canDownload = allowedActions?.includes('download') && media.downloadUrl;

  const handleAudioError = useCallback(() => {
    setPlaybackFailed(true);
  }, []);

  return (
    <section
      data-audio-overview
      className="mx-auto flex w-full max-w-2xl flex-col gap-5 rounded-3xl border border-line bg-surface/80 p-5 shadow-[var(--shadow-float)] sm:p-7"
      aria-label="音频概览"
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
        onError={handleAudioError}
      >
        你的浏览器不支持音频播放。
      </audio>
      {playbackFailed ? (
        <p className="text-xs text-accent" role="alert">
          音频播放不可用，以下为文字稿。
        </p>
      ) : null}
      <div className="rounded-2xl bg-surface-strong/65 px-4 py-3">
        <h3 className="text-sm font-medium text-ink">文字稿</h3>
        <p
          className="mt-2 whitespace-pre-wrap text-sm leading-7 text-ink-muted"
          aria-label="音频文字稿"
        >
          {media.transcript}
        </p>
      </div>
      {canDownload ? (
        <a
          href={media.downloadUrl}
          download
          className="inline-flex items-center gap-1.5 self-start rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-surface-strong"
        >
          下载音频
        </a>
      ) : null}
    </section>
  );
}
