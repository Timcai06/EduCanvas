import type { ArtifactDetail } from './artifact-client';

/**
 * Canvas 溯源的纯判定逻辑，独立于渲染组件以便单测（组件在 .tsx，测试从这里
 * 引入避免 JSX 转换）。
 */

/** 产物是否正在生成（首次或共创修改）。 */
export function isArtifactGenerating(
  detail: ArtifactDetail,
  revising: boolean,
): boolean {
  const status = detail.latestJob?.status;
  return revising || status === 'queued' || status === 'running';
}
