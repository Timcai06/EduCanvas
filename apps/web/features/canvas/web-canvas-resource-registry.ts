import type { CanvasResource } from '@educanvas/canvas-protocol';
import {
  createCanvasResourceRegistry,
  selectCanvasResourceRenderer,
  type CanvasResourceRegistry,
  type CanvasResourceRendererProps,
  type CanvasResourceSelection,
} from './canvas-resource-registry';
import {
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
} from './canvas-resource-renderers';
import { WEB_REGISTRY_ENTRIES } from './web-canvas-resource-registry-config';

const COMPONENT_MAP: Record<
  string,
  React.ComponentType<CanvasResourceRendererProps>
> = {
  'source.pdf': SourcePdfResourceRenderer,
  'source.image': SourceImageResourceRenderer,
  'source.markdown': SourceMarkdownResourceRenderer,
  'source.text': SourceTextResourceRenderer,
  'source.docx': SourceDocxResourceRenderer,
  'source.audio': SourceAudioResourceRenderer,
  'source.video': SourceVideoResourceRenderer,
  'artifact.mind-map': MindMapResourceRenderer,
  'artifact.slides': SlidesResourceRenderer,
  'artifact.flashcards': FlashcardsResourceRenderer,
  'artifact.audio-overview': AudioOverviewResourceRenderer,
  'artifact.generated-image': GeneratedImageResourceRenderer,
};

/**
 * Web 应用的 Canvas 资源注册表组合根。
 *
 * 只注册本地受信 React 组件，不接受 URL、动态 import、远程脚本或模型代码。
 * 每个 rendererId 对应服务端 adapter 实际可能返回的安全集合。
 */
export const webCanvasResourceRegistry: CanvasResourceRegistry =
  createCanvasResourceRegistry(
    WEB_REGISTRY_ENTRIES.map((entry) => ({
      manifest: entry.manifest as Parameters<
        typeof createCanvasResourceRegistry
      >[0][number]['manifest'],
      Renderer: COMPONENT_MAP[entry.rendererId]!,
    })),
  );

/**
 * 选择资源对应的 Renderer；返回稳定判别联合。
 * 不兼容组合返回 unavailable 而不是抛错。
 */
export function selectWebCanvasResourceRenderer(
  resource: CanvasResource,
): CanvasResourceSelection {
  return selectCanvasResourceRenderer(webCanvasResourceRegistry, resource);
}
