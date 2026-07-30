import { createElement } from 'react';
import type { CanvasResourceRendererProps } from './canvas-resource-registry';
import { CanvasShellStatus } from './canvas-shell-status';
import { SourceResourceRendererBody } from '../assets/source-resource-renderer';

/**
 * Artifact 仍由既有 ArtifactCanvas 读取受控详情并渲染。这里的本地组件只作为
 * registry 的兼容边界；若组合层误把它直接挂载，也必须明确失败，不能用空内容
 * 伪造一个可编辑或可判分的 Artifact。
 */
function ArtifactCompatibilityRenderer({
  resource,
}: CanvasResourceRendererProps) {
  return createElement(
    'div',
    { 'data-renderer-id': resource.renderer.rendererId },
    createElement(CanvasShellStatus, {
      status: 'unavailable',
      title: '需要兼容渲染链',
      description: '请通过受控的 Artifact 详情入口打开此内容。',
    }),
  );
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

const MindMapResourceRenderer = ArtifactCompatibilityRenderer;
const SlidesResourceRenderer = ArtifactCompatibilityRenderer;
const FlashcardsResourceRenderer = ArtifactCompatibilityRenderer;
const NoteResourceRenderer = ArtifactCompatibilityRenderer;
const AudioOverviewResourceRenderer = ArtifactCompatibilityRenderer;
const GeneratedImageResourceRenderer = ArtifactCompatibilityRenderer;

export {
  MindMapResourceRenderer,
  SlidesResourceRenderer,
  FlashcardsResourceRenderer,
  NoteResourceRenderer,
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
