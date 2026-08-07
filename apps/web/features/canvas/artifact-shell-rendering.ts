import type { CanvasResource } from '@educanvas/canvas-protocol';

/**
 * 由 ArtifactCanvas 壳显式渲染的交互式 Artifact rendererId 集合。
 *
 * note（笔记编辑）与 dom_exploration（沙箱运行时）不是内容驱动产物：内容本体在
 * 客户端交互中产生，Registry 不承载对应条目（W04-4 已删除占位）。Studio 打开验证
 * 须识别它们并直接放行到壳，而不是按 rendererId_not_registered 判为不可用。
 */
export const SHELL_RENDERED_ARTIFACT_RENDERER_IDS: ReadonlySet<string> =
  new Set(['artifact.note', 'artifact.dom-exploration']);

/**
 * 判断 CanvasResource 是否由 ArtifactCanvas 壳显式渲染（Registry 无条目）。
 * 仅对 resourceKind === 'artifact' 生效，Source 永不命中。
 */
export function isShellRenderedArtifactResource(
  resource: CanvasResource,
): boolean {
  return (
    resource.resourceKind === 'artifact' &&
    SHELL_RENDERED_ARTIFACT_RENDERER_IDS.has(resource.renderer.rendererId)
  );
}
