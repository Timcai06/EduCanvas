'use client';

import { useMemo } from 'react';
import type { NoteContent } from '@educanvas/canvas-protocol';
import { buildArtifactCanvasResource } from './artifact-canvas-resource';
import type { ArtifactContentView } from './artifact-content-view';
import type {
  ArtifactDetail,
  ArtifactVersionData,
} from './artifact-client';
import { ArtifactGeneratingSkeleton } from './artifact-provenance';
import { CanvasShellStatus } from './canvas-shell-status';
import { NoteRenderer } from './note-renderer';
import { PersistentWebRuntime } from './persistent-web-runtime';
import { selectWebCanvasResourceRenderer } from './web-canvas-resource-registry';

/**
 * Artifact Canvas 内容区分发（W04-3）。
 *
 * 内容驱动型（mind_map / slides / flashcards / audio_overview /
 * generated_image）改由 Registry 选择真实 Renderer 渲染；交互式产物
 * （note 编辑、dom_exploration 运行时）仍由本壳渲染——它们不是内容驱动，
 * Registry 里的对应占位只在未接住时给出明确提示。
 */

type ArtifactRegistryViewKinds =
  | 'mind_map'
  | 'slides'
  | 'flashcards'
  | 'audio_overview'
  | 'generated_image';

/** 走 Registry 的 5 类内容驱动分发结果。 */
export type ArtifactRegistryContentView = Extract<
  ArtifactContentView,
  { kind: ArtifactRegistryViewKinds }
>;

/**
 * 把内容分发结果转换为 Registry 注入的受控 `ArtifactVersionData`：
 * 文本结构类携带 content、媒体类携带 media。这是纯转换，供测试直接断言。
 */
export function toArtifactVersionData(
  view: ArtifactRegistryContentView,
): ArtifactVersionData {
  switch (view.kind) {
    case 'mind_map':
    case 'slides':
    case 'flashcards':
      return { content: view.content, media: null };
    case 'audio_overview':
    case 'generated_image':
      return { content: null, media: view.media };
  }
}

function ArtifactRegistryContent({
  view,
  detail,
}: {
  view: ArtifactRegistryContentView;
  detail: ArtifactDetail;
}) {
  const resource = useMemo(
    () => buildArtifactCanvasResource(detail),
    [detail],
  );
  const selection = selectWebCanvasResourceRenderer(resource);
  if (selection.kind === 'unavailable') {
    return (
      <CanvasShellStatus
        status="unavailable"
        title="内容不可用"
        description="当前产物类型没有可用的渲染器。"
      />
    );
  }
  const Renderer = selection.Renderer;
  const versionKey =
    view.kind === 'mind_map' ||
    view.kind === 'slides' ||
    view.kind === 'flashcards'
      ? view.key
      : undefined;
  return (
    <Renderer
      key={versionKey}
      resource={resource}
      content={toArtifactVersionData(view)}
    />
  );
}

export function ArtifactCanvasContent({
  contentView,
  detail,
  revising,
  onSaveNote,
}: {
  contentView: ArtifactContentView;
  detail: ArtifactDetail;
  revising: boolean;
  onSaveNote: (markdown: string) => void;
}) {
  switch (contentView.kind) {
    case 'skeleton':
      return <ArtifactGeneratingSkeleton />;
    case 'mind_map':
    case 'slides':
    case 'flashcards':
    case 'audio_overview':
    case 'generated_image':
      return <ArtifactRegistryContent view={contentView} detail={detail} />;
    case 'note':
      return (
        <NoteRenderer
          key={contentView.key}
          content={contentView.content as NoteContent}
          isLatest={contentView.isLatest}
          readOnly={!contentView.isLatest}
          onSave={onSaveNote}
          saving={revising}
        />
      );
    case 'dom_exploration':
      return (
        <PersistentWebRuntime
          key={contentView.versionId}
          artifactId={detail.artifact.id}
          artifactVersionId={contentView.versionId}
        />
      );
    case 'empty':
      return (
        <p className="text-sm text-ink-muted">该产物还没有可显示的版本。</p>
      );
  }
}
