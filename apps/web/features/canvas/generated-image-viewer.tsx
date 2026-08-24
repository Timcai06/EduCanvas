'use client';

/**
 * 生成图像的无障碍渲染器。使用 figure/figcaption 语义，
 * alt text 来源于公开元数据(标题、尺寸、类型)，绝不使用生成 Prompt。
 * 非 Web 消费者通过 mediaSummary 获得有界文本等价。
 */

import type { GeneratedImageMedia } from './artifact-client';
import { buildImageSummary } from './media-text-equivalence';

function parseSizeDim(
  size: '512x512' | '1024x1024' | '1024x1536' | '1536x1024',
  index: 0 | 1,
): number | undefined {
  const parts = size.split('x');
  const raw = parts[index];
  return raw !== undefined ? Number.parseInt(raw, 10) : undefined;
}

export function GeneratedImageViewer({
  title,
  media,
  allowedActions,
}: {
  title: string;
  media: GeneratedImageMedia;
  allowedActions?: readonly string[];
}) {
  const altText = buildImageSummary(title, media);
  const canDownload = allowedActions?.includes('download') && media.downloadUrl;

  return (
    <figure className="flex flex-col items-center gap-2">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={media.url}
        alt={altText}
        loading="lazy"
        decoding="async"
        className="mx-auto max-h-full max-w-full rounded-2xl object-contain shadow-[var(--shadow-float)]"
        width={parseSizeDim(media.size, 0)}
        height={parseSizeDim(media.size, 1)}
      />
      <figcaption className="max-w-prose text-center text-xs text-ink-muted">
        {altText}
      </figcaption>
      {canDownload ? (
        <a
          href={media.downloadUrl}
          download
          className="inline-flex items-center gap-1.5 self-center rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-surface-strong"
        >
          下载图像
        </a>
      ) : null}
    </figure>
  );
}
