import type { AssetItem } from '@/features/assets/assets-drawer';
import type { ArtifactSummary } from '@/features/canvas/artifact-client';

export type StudioRoute = 'source-browse' | 'output-browse';

export const ROOT_ITEMS = ['来源', 'AI 产物'] as const;

/** Studio只返回当前Notebook内可浏览、可管理的实体，不混入创建动作。 */
export function itemsForRoute(
  route: StudioRoute,
  assets: readonly AssetItem[],
  outputs: readonly ArtifactSummary[],
): readonly string[] {
  if (route === 'source-browse') {
    return assets.length === 0
      ? ['暂无来源']
      : assets.map((asset) => `${asset.label} · ${assetStatus(asset)}`);
  }
  return outputs.length === 0
    ? ['暂无 AI 产物']
    : outputs.map(
        (output) =>
          `${output.title} · ${output.latestVersion > 0 ? `v${output.latestVersion}` : '生成中'}`,
      );
}

export function routeLabel(route: StudioRoute): string {
  return route === 'source-browse'
    ? '浏览当前Notebook来源'
    : '浏览当前Notebook的AI产物';
}

function assetStatus(asset: AssetItem): string {
  if (asset.status === 'ready') return asset.enabled ? '已用于对话' : '未使用';
  if (asset.status === 'failed') return '处理失败';
  return '处理中';
}
