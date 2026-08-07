import { createElement } from 'react';
import type { CanvasResourceRendererProps } from './canvas-resource-registry';
import { CanvasShellStatus } from './canvas-shell-status';
import { SourceResourceRendererBody } from '../assets/source-resource-renderer';
import { MindMapRenderer } from './mind-map-renderer';
import { SlidesRenderer } from './slides-renderer';
import { FlashcardsRenderer } from './flashcards-renderer';
import { AudioOverviewPlayer } from './audio-overview-player';
import { GeneratedImageViewer } from './generated-image-viewer';
import type { ArtifactVersionData } from './artifact-client';

/**
 * W04（选项 1）：内容驱动型 Artifact 的真实 Renderer 迁入 Registry。
 *
 * 每个适配器接收 `{ resource, content }`——`content` 是组合层注入的受控
 * `ArtifactVersionData`。适配器把 `content` 分发给对应真实 Renderer；缺数据或
 * 媒体子类型不匹配时显示 unavailable 而非伪造内容。
 *
 * note（编辑交互）与 dom_exploration（运行时环境）由 ArtifactCanvas 壳显式渲染，
 * 不进 Registry（无占位条目）；Registry 只承载内容驱动型 Artifact 与 Source。
 */

function unavailable(title: string, description: string) {
  return createElement(CanvasShellStatus, {
    status: 'unavailable',
    title,
    description,
  });
}

function MindMapResourceRenderer({ content }: CanvasResourceRendererProps) {
  const data = content as ArtifactVersionData | undefined;
  if (data === undefined) {
    return unavailable('内容不可用', '缺少受控渲染数据。');
  }
  return createElement(MindMapRenderer, { content: data.content });
}

function SlidesResourceRenderer({ content }: CanvasResourceRendererProps) {
  const data = content as ArtifactVersionData | undefined;
  if (data === undefined) {
    return unavailable('内容不可用', '缺少受控渲染数据。');
  }
  return createElement(SlidesRenderer, { content: data.content });
}

function FlashcardsResourceRenderer({ content }: CanvasResourceRendererProps) {
  const data = content as ArtifactVersionData | undefined;
  if (data === undefined) {
    return unavailable('内容不可用', '缺少受控渲染数据。');
  }
  return createElement(FlashcardsRenderer, { content: data.content });
}

function AudioOverviewResourceRenderer({
  resource,
  content,
}: CanvasResourceRendererProps) {
  const data = content as ArtifactVersionData | undefined;
  if (data?.media?.contentType !== 'audio/mpeg') {
    return unavailable('音频不可用', '没有可播放的音频内容。');
  }
  return createElement(AudioOverviewPlayer, {
    media: data.media,
    allowedActions: resource.allowedActions,
  });
}

function GeneratedImageResourceRenderer({
  resource,
  content,
}: CanvasResourceRendererProps) {
  const data = content as ArtifactVersionData | undefined;
  if (
    !data?.media ||
    !('size' in data.media) ||
    !data.media.contentType.startsWith('image/')
  ) {
    return unavailable('图片不可用', '没有可显示的图片内容。');
  }
  return createElement(GeneratedImageViewer, {
    title: resource.title,
    media: data.media,
    allowedActions: resource.allowedActions,
  });
}

function SourcePdfResourceRenderer({ resource }: CanvasResourceRendererProps) {
  return createElement(SourceResourceRendererBody, { resource });
}

function SourceImageResourceRenderer({
  resource,
}: CanvasResourceRendererProps) {
  return createElement(SourceResourceRendererBody, { resource });
}

function SourceMarkdownResourceRenderer({
  resource,
}: CanvasResourceRendererProps) {
  return createElement(SourceResourceRendererBody, { resource });
}

function SourceTextResourceRenderer({ resource }: CanvasResourceRendererProps) {
  return createElement(SourceResourceRendererBody, { resource });
}

function SourceDocxResourceRenderer({ resource }: CanvasResourceRendererProps) {
  return createElement(SourceResourceRendererBody, { resource });
}

function SourceAudioResourceRenderer({
  resource,
}: CanvasResourceRendererProps) {
  return createElement(SourceResourceRendererBody, { resource });
}

function SourceVideoResourceRenderer({
  resource,
}: CanvasResourceRendererProps) {
  return createElement(SourceResourceRendererBody, { resource });
}

export {
  MindMapResourceRenderer,
  SlidesResourceRenderer,
  FlashcardsResourceRenderer,
  AudioOverviewResourceRenderer,
  GeneratedImageResourceRenderer,
  SourcePdfResourceRenderer,
  SourceImageResourceRenderer,
  SourceMarkdownResourceRenderer,
  SourceTextResourceRenderer,
  SourceDocxResourceRenderer,
  SourceAudioResourceRenderer,
  SourceVideoResourceRenderer,
};
