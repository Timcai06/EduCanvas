'use client';

import { useMemo } from 'react';
import {
  markdownDocumentContentSchema,
  type NoteContent,
} from '@educanvas/canvas-protocol';
import type { ArtifactContentView } from './artifact-content-view';
import type { ArtifactDetail, ArtifactVersionData } from './artifact-client';
import { ArtifactGeneratingSkeleton } from './artifact-provenance';
import { CanvasShellStatus } from './canvas-shell-status';
import { NoteRenderer } from './note-renderer';
import { PersistentWebRuntime } from './persistent-web-runtime';
import { WebAppArtifactView } from './web-app-artifact-view';
import { selectWebCanvasResourceRenderer } from './web-canvas-resource-registry';

/**
 * Artifact Canvas 内容区分发（W04-3）。
 *
 * 内容驱动型（mind_map / slides / flashcards / picturebook / audio_overview /
 * generated_image）改由 Registry 选择真实 Renderer 渲染；交互式产物
 * （note 编辑、dom_exploration 运行时）仍由本壳渲染——它们不是内容驱动，
 * Registry 里的对应占位只在未接住时给出明确提示。
 */

type ArtifactRegistryViewKinds =
  | 'mind_map'
  | 'slides'
  | 'flashcards'
  | 'picturebook'
  | 'audio_overview'
  | 'generated_image'
  | 'markdown_document';

/** 走 Registry 的内容驱动分发结果。 */
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
    case 'picturebook':
    case 'markdown_document':
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
  // 服务端 projection 是唯一权威：detail.canvasResource 已是完整验证后的协议
  // 对象（parser 层 fail closed），Registry 直接消费，不再按 kind 重建。
  const resource = useMemo(
    () => detail.canvasResource ?? null,
    [detail.canvasResource],
  );
  if (resource === null) {
    // 后端未返回可打开资源（如仍在 processing / 尚无 immutable version）时
    // 不伪造 notebookId/version/renderer/provenance/runtime，显示诚实状态。
    return (
      <CanvasShellStatus
        status="unavailable"
        title="内容尚不可用"
        description="产物尚未生成可查看的版本。"
      />
    );
  }
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
    view.kind === 'flashcards' ||
    view.kind === 'picturebook'
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
  readOnly = false,
  presentation = 'canvas',
}: {
  contentView: ArtifactContentView;
  detail: ArtifactDetail;
  revising: boolean;
  onSaveNote: (markdown: string) => void;
  /** Live 等只读宿主不得让最新版笔记在旁路视图中产生写入。 */
  readOnly?: boolean;
  /** Live 只读壳不启动会产生 Provider/任务副作用的持久 Web Runtime。 */
  presentation?: 'canvas' | 'live-preview';
}) {
  switch (contentView.kind) {
    case 'skeleton':
      return <ArtifactGeneratingSkeleton />;
    case 'mind_map':
    case 'slides':
    case 'flashcards':
    case 'picturebook':
    case 'audio_overview':
    case 'generated_image':
      return <ArtifactRegistryContent view={contentView} detail={detail} />;
    case 'note':
      return (
        <NoteRenderer
          key={contentView.key}
          content={contentView.content as NoteContent}
          isLatest={contentView.isLatest}
          readOnly={readOnly || !contentView.isLatest}
          onSave={onSaveNote}
          saving={revising}
        />
      );
    case 'markdown_document': {
      const parsed = markdownDocumentContentSchema.safeParse(
        contentView.content,
      );
      if (!parsed.success) {
        return (
          <CanvasShellStatus
            status="unavailable"
            title="Markdown 文档不可用"
            description="当前版本内容未通过文档协议校验。"
          />
        );
      }
      return (
        <NoteRenderer
          key={contentView.key}
          content={parsed.data}
          isLatest={contentView.isLatest}
          readOnly={readOnly || !contentView.isLatest}
          onSave={onSaveNote}
          saving={revising}
        />
      );
    }
    case 'dom_exploration':
      if (presentation === 'live-preview') {
        return (
          <CanvasShellStatus
            status="unavailable"
            title="交互网页需在 Canvas 打开"
            description="Live 预览不会启动或取消持久运行任务；结束语音后可在 Canvas 中完整交互。"
          />
        );
      }
      return (
        <PersistentWebRuntime
          key={contentView.versionId}
          artifactId={detail.artifact.id}
          artifactVersionId={contentView.versionId}
        />
      );
    case 'web_app':
      return (
        <WebAppArtifactView
          artifactId={detail.artifact.id}
          artifactVersionId={contentView.versionId}
          content={contentView.content}
          presentation={presentation}
        />
      );
    case 'web_app_unavailable':
      return (
        <CanvasShellStatus
          status="unavailable"
          title="Web App 内容不可用"
          description="产物内容不符合 Web App 安全协议。"
        />
      );
    case 'empty':
      return (
        <p className="text-sm text-ink-muted">该产物还没有可显示的版本。</p>
      );
  }
}
