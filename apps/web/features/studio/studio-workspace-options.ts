import type { OptionWheelItem } from '@/components/OptionWheel';
import type { AssetItem } from '@/features/assets/assets-drawer';
import type { ArtifactSummary } from '@/features/canvas/artifact-client';

export type StudioRoute = 'source-browse' | 'output-browse';

export const ROOT_ITEMS = ['来源', 'AI 产物'] as const;

/**
 * 空态占位的固定 id。它必须是 disabled 条目：仍然能被滚到中心以便读屏播报
 * 「暂无」，但确认动作要落空，否则会拿一个不存在的资产去开 Canvas。
 */
const EMPTY_ITEM_ID = 'studio-empty';

/**
 * Studio只返回当前Notebook内可浏览、可管理的实体，不混入创建动作。
 *
 * 条目 id 直接用资产/产物的真实 ID，让滚轮的 React key 在列表重排（产物按更新
 * 时间排序会重排）时保持稳定；状态走 `secondary` 而不是拼进 `label`，否则读屏
 * 会把状态读成名称的一部分。
 */
export function itemsForRoute(
  route: StudioRoute,
  assets: readonly AssetItem[],
  outputs: readonly ArtifactSummary[],
): readonly OptionWheelItem[] {
  if (route === 'source-browse') {
    return assets.length === 0
      ? [{ id: EMPTY_ITEM_ID, label: '暂无来源', disabled: true }]
      : assets.map((asset) => ({
          id: asset.id,
          label: asset.label,
          secondary: assetStatus(asset),
        }));
  }
  return outputs.length === 0
    ? [{ id: EMPTY_ITEM_ID, label: '暂无 AI 产物', disabled: true }]
    : outputs.map((output) => ({
        id: output.id,
        label: output.title,
        secondary:
          output.latestVersion > 0 ? `v${output.latestVersion}` : '生成中',
      }));
}

export function routeLabel(route: StudioRoute): string {
  return route === 'source-browse'
    ? '浏览当前Notebook来源'
    : '浏览当前Notebook的AI产物';
}

/**
 * 来源状态优先读服务端授权过的 `canvasResource.status`；没有资源描述
 * （旧端点或未知 MIME）时退回本地 descriptor 状态，不自行推断可用动作。
 */
function assetStatus(asset: AssetItem): string {
  const status = asset.resource?.status ?? asset.status;
  if (status === 'failed') return '处理失败';
  if (status === 'unavailable') return '不可用';
  if (status === 'ready') return asset.enabled ? '已用于对话' : '未使用';
  return '处理中';
}
