import { beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
  cleanups: [] as Array<() => void>,
  state: undefined as unknown,
}));

vi.mock('react', () => ({
  useCallback: <T extends (...args: never[]) => unknown>(callback: T) =>
    callback,
  useEffect: (effect: () => void | (() => void)) => {
    const cleanup = effect();
    if (cleanup) harness.cleanups.push(cleanup);
  },
  useRef: <T>(current: T) => ({ current }),
  useState: <T>(initial: T) => {
    if (harness.state === undefined) {
      harness.state = initial;
    }
    const setState = (next: T | ((current: T) => T)) => {
      harness.state =
        typeof next === 'function'
          ? (next as (current: T) => T)(harness.state as T)
          : next;
    };
    return [harness.state as T, setState] as const;
  },
}));

vi.mock('@/features/assets/asset-client', () => ({
  deleteAsset: vi.fn(),
  loadAssets: vi.fn(),
  renameAsset: vi.fn(),
  setAssetEnabled: vi.fn(),
}));

import { hasSettledAssetTransition } from './use-notebook-sources';
import { useNotebookSources } from './use-notebook-sources';
import { deleteAsset, loadAssets } from '@/features/assets/asset-client';
import type { AssetItem } from '@/features/assets/assets-drawer';
import type { ResourceClientError } from '@/features/canvas/resource-error';

const sourceAsset = (id: string): AssetItem =>
  ({
    id,
    versionId: `${id}-version`,
    label: id,
    kind: 'link',
    scope: 'space',
    status: 'ready',
    processing: null,
    enabled: true,
    selectable: true,
    resource: null,
  }) as AssetItem;

const useSourcesHarness = (input?: {
  onError?: (error: ResourceClientError) => void;
  onSettled?: () => void;
}) =>
  useNotebookSources({
    endpoint: '/api/v1/assets',
    onError: input?.onError ?? vi.fn(),
    onSettled: input?.onSettled ?? vi.fn(),
  });

beforeEach(() => {
  vi.clearAllMocks();
  harness.cleanups = [];
  harness.state = undefined;
  vi.mocked(loadAssets).mockReturnValue(new Promise(() => undefined));
});

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

describe('useNotebookSources remove', () => {
  it('成功删除后移除来源并通知 resource dock reload', async () => {
    let resolveDelete!: () => void;
    vi.mocked(deleteAsset).mockReturnValue(
      new Promise<void>((resolve) => {
        resolveDelete = resolve;
      }),
    );
    const onSettled = vi.fn();
    const sources = useSourcesHarness({ onSettled });
    const item = sourceAsset('source-1');
    sources.setAssets([item]);

    sources.remove(item);
    sources.remove(item);
    expect(deleteAsset).toHaveBeenCalledOnce();

    resolveDelete();
    await Promise.resolve();
    await Promise.resolve();

    expect(harness.state).toEqual([]);
    expect(onSettled).toHaveBeenCalledOnce();
  });

  it('删除失败时保留来源且不触发 reload', async () => {
    const onError = vi.fn() as unknown as (error: ResourceClientError) => void;
    const onSettled = vi.fn();
    vi.mocked(deleteAsset).mockRejectedValueOnce(new Error('delete failed'));
    const sources = useSourcesHarness({ onError, onSettled });
    const item = sourceAsset('source-1');
    sources.setAssets([item]);

    sources.remove(item);
    await Promise.resolve();
    await Promise.resolve();

    expect(harness.state).toEqual([item]);
    expect(onSettled).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledOnce();
  });

  it('卸载后忽略迟到的删除结果', async () => {
    let resolveDelete!: () => void;
    vi.mocked(deleteAsset).mockReturnValue(
      new Promise<void>((resolve) => {
        resolveDelete = resolve;
      }),
    );
    const onSettled = vi.fn();
    const sources = useSourcesHarness({ onSettled });
    const item = sourceAsset('source-1');
    sources.setAssets([item]);
    sources.remove(item);
    for (const cleanup of harness.cleanups) cleanup();

    resolveDelete();
    await Promise.resolve();
    await Promise.resolve();

    expect(harness.state).toEqual([item]);
    expect(onSettled).not.toHaveBeenCalled();
  });
});
