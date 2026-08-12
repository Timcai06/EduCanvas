import type { CanvasResourceAction } from '@educanvas/canvas-protocol';
import { webAppContentSchema } from '@educanvas/canvas-protocol';
import type { WebAppContent } from '@educanvas/canvas-protocol';
import type {
  ArtifactDetail,
  AudioOverviewMedia,
  GeneratedImageMedia,
} from './artifact-client';
import { isArtifactGenerating } from './artifact-provenance-model';

/**
 * Artifact 内容区的纯分发判定（W04 characterization）。
 *
 * 从 `ArtifactCanvas` 的内联条件链提取为纯函数，钉住「每种 kind + version 数据 →
 * 渲染什么」的契约；组件只消费该结果，便于在迁移 Registry 时复用同一分发逻辑。
 *
 * 条件必须与既有渲染行为严格一致（包括 audio/generated_image 的媒体子类型门槛），
 * 不能因重构改变「什么内容可显示」。
 */

export type ArtifactContentView =
  | { kind: 'skeleton' }
  | { kind: 'mind_map'; content: unknown; key: number }
  | { kind: 'slides'; content: unknown; key: number }
  | { kind: 'flashcards'; content: unknown; key: number }
  | {
      kind: 'markdown_document';
      content: unknown;
      key: number;
      isLatest: boolean;
    }
  | { kind: 'note'; content: unknown; key: number; isLatest: boolean }
  | {
      kind: 'audio_overview';
      media: AudioOverviewMedia;
      allowedActions: readonly CanvasResourceAction[];
    }
  | {
      kind: 'generated_image';
      media: GeneratedImageMedia;
      title: string;
      allowedActions: readonly CanvasResourceAction[];
    }
  | { kind: 'dom_exploration'; versionId: string }
  | { kind: 'web_app'; versionId: string; content: WebAppContent }
  | { kind: 'web_app_unavailable'; versionId: string }
  | { kind: 'empty' };

export function resolveArtifactContentView(
  detail: ArtifactDetail,
  revising: boolean,
): ArtifactContentView {
  const displayedVersion = detail.version?.version ?? 0;
  const isLatest = displayedVersion === detail.artifact.latestVersion;
  const generating = isArtifactGenerating(detail, revising);
  const allowedActions = detail.canvasResource?.allowedActions ?? [];

  /* 生成中且展示的最新版还没有内容:显示骨架而非空态文案。 */
  if (generating && isLatest && !detail.version) {
    return { kind: 'skeleton' };
  }

  if (detail.artifact.kind === 'mind_map' && detail.version) {
    return {
      kind: 'mind_map',
      content: detail.version.content,
      key: displayedVersion,
    };
  }
  if (detail.artifact.kind === 'slides' && detail.version) {
    return {
      kind: 'slides',
      content: detail.version.content,
      key: displayedVersion,
    };
  }
  if (detail.artifact.kind === 'flashcards' && detail.version) {
    return {
      kind: 'flashcards',
      content: detail.version.content,
      key: displayedVersion,
    };
  }
  if (
    detail.artifact.kind === 'audio_overview' &&
    detail.version?.media?.contentType === 'audio/mpeg'
  ) {
    return {
      kind: 'audio_overview',
      media: detail.version.media,
      allowedActions,
    };
  }
  if (
    detail.artifact.kind === 'generated_image' &&
    detail.version?.media &&
    'size' in detail.version.media &&
    detail.version.media.contentType.startsWith('image/')
  ) {
    return {
      kind: 'generated_image',
      media: detail.version.media,
      title: detail.artifact.title,
      allowedActions,
    };
  }
  if (detail.artifact.kind === 'note' && detail.version) {
    return {
      kind: 'note',
      content: detail.version.content,
      key: displayedVersion,
      isLatest,
    };
  }
  if (detail.artifact.kind === 'markdown_document' && detail.version) {
    return {
      kind: 'markdown_document',
      content: detail.version.content,
      key: displayedVersion,
      isLatest,
    };
  }
  if (detail.artifact.kind === 'dom_exploration' && detail.version) {
    return { kind: 'dom_exploration', versionId: detail.version.id };
  }
  if (detail.artifact.kind === 'web_app' && detail.version) {
    const parsed = webAppContentSchema.safeParse(detail.version.content);
    if (!parsed.success)
      return { kind: 'web_app_unavailable', versionId: detail.version.id };
    return {
      kind: 'web_app',
      versionId: detail.version.id,
      content: parsed.data,
    };
  }

  return { kind: 'empty' };
}
