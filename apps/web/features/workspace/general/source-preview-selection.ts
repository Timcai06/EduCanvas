import type { AssetItem } from '@/features/assets/assets-drawer';

/**
 * 用稳定ID从最新来源集合解析预览对象。
 *
 * 来源处理状态由轮询替换；调用方不得继续使用用户点击时的旧对象快照。
 */
export function resolveSourcePreview(
  assets: readonly AssetItem[],
  selectedAssetId: string | null,
): AssetItem | null {
  if (selectedAssetId === null) return null;
  return assets.find((asset) => asset.id === selectedAssetId) ?? null;
}
