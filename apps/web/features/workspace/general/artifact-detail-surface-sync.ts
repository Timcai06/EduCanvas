import type { ArtifactDetail } from '@/features/canvas/artifact-client';

/**
 * 判定 Artifact 详情是否「新打开」（从无到有）。
 *
 * `artifactFlow.confirm`（openWhenReady）与 `observeProposedArtifact` 成功时只在内部
 * `setOpenDetail`，不会 dispatch surface；本判定用于在详情新出现时补一次
 * `openArtifact`，让 surface 与详情同步进入 artifact 工作面。
 *
 * 独立于 controller 便于测试：controller 是 `'use client'` 模块，连带依赖
 * server-only 链路，测试只 import 本纯函数。
 */
export function shouldOpenArtifactSurface(
  prevDetail: ArtifactDetail | null,
  nextDetail: ArtifactDetail | null,
): nextDetail is ArtifactDetail {
  return prevDetail === null && nextDetail !== null;
}
