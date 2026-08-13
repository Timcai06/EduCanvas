import { describe, expect, it } from 'vitest';
import { hasSettledAssetTransition } from './use-notebook-sources';
import type { AssetItem } from '@/features/assets/assets-drawer';

function asset(
  id: string,
  status: AssetItem['status'],
): Pick<AssetItem, 'id' | 'status'> {
  return { id, status };
}

describe('hasSettledAssetTransition', () => {
  it('处理中资产收敛到终态时返回 true', () => {
    expect(
      hasSettledAssetTransition(
        [asset('a', 'processing')],
        [asset('a', 'ready')],
      ),
    ).toBe(true);
    expect(
      hasSettledAssetTransition(
        [asset('a', 'pending')],
        [asset('a', 'failed')],
      ),
    ).toBe(true);
  });

  it('新增即终态的资产返回 true（图片直传等无解析阶段）', () => {
    expect(
      hasSettledAssetTransition(
        [asset('a', 'ready')],
        [asset('a', 'ready'), asset('b', 'ready')],
      ),
    ).toBe(true);
  });

  it('仍在处理中、状态未变或终态间迁移时不返回 true', () => {
    expect(
      hasSettledAssetTransition(
        [asset('a', 'pending')],
        [asset('a', 'processing')],
      ),
    ).toBe(false);
    expect(
      hasSettledAssetTransition([asset('a', 'ready')], [asset('a', 'ready')]),
    ).toBe(false);
    expect(
      hasSettledAssetTransition([asset('a', 'ready')], [asset('a', 'failed')]),
    ).toBe(false);
  });

  it('初始装载（上一集合为空）不算转变：仅存在终态新资产时返回 true 的语义由 announce 层屏蔽', () => {
    /* 初始装载经 applyAssets(next, announce=false) 路径，不调用本函数；
       这里只锁定纯函数对空前集的判定，供调用层作为差异依据。 */
    expect(hasSettledAssetTransition([], [asset('a', 'ready')])).toBe(true);
    expect(hasSettledAssetTransition([], [])).toBe(false);
  });
});
