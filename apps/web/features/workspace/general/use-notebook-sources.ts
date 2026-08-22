'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  deleteAsset,
  loadAssets,
  renameAsset,
  setAssetEnabled,
} from '@/features/assets/asset-client';
import type { AssetItem } from '@/features/assets/assets-drawer';
import {
  detectAssetStatusNotices,
  type AssetStatusNotice,
} from '@/features/assets/asset-status';
import {
  LatestRequestGuard,
  ResourceClientError,
  toClientError,
} from '@/features/canvas/resource-error';

/**
 * 当前 Notebook 的来源集合与其变更动作。
 *
 * 从工作区组件里抽出来，是为了让「来源怎么变」有一个单独可读的落点：
 * 启停、重命名、删除三者的乐观策略和授权层级各不相同，混在渲染组件里
 * 很难看清差别。组件仍持有 UI 状态，这里只负责来源事实。
 */
const TRANSIENT_ASSET_STATUSES: ReadonlySet<AssetItem['status']> = new Set([
  'pending',
  'processing',
]);
const TERMINAL_ASSET_STATUSES: ReadonlySet<AssetItem['status']> = new Set([
  'ready',
  'failed',
  'tombstoned',
]);

/** 集合里是否存在「处理中 → 终态」或「新增即终态」的转变；供只读列表联动刷新。 */
export function hasSettledAssetTransition(
  previous: readonly Pick<AssetItem, 'id' | 'status'>[],
  next: readonly Pick<AssetItem, 'id' | 'status'>[],
): boolean {
  const previousStatusById = new Map(
    previous.map((asset) => [asset.id, asset.status]),
  );
  return next.some((asset) => {
    const previousStatus = previousStatusById.get(asset.id);
    if (previousStatus === undefined) {
      return TERMINAL_ASSET_STATUSES.has(asset.status);
    }
    return (
      TRANSIENT_ASSET_STATUSES.has(previousStatus) &&
      TERMINAL_ASSET_STATUSES.has(asset.status)
    );
  });
}

export function useNotebookSources(input: {
  endpoint: string;
  onError: (error: ResourceClientError) => void;
  onStatus?: (notice: AssetStatusNotice) => void;
  /* 资产收敛到终态时回调；announce=false 的初始装载不算转变。 */
  onSettled?: () => void;
}): {
  assets: readonly AssetItem[];
  setAssets: React.Dispatch<React.SetStateAction<readonly AssetItem[]>>;
  refresh: () => Promise<void>;
  toggle: (asset: AssetItem) => void;
  rename: (asset: AssetItem, displayName: string) => void;
  remove: (asset: AssetItem) => void;
} {
  const { endpoint, onError, onSettled, onStatus } = input;
  const [assets, setAssets] = useState<readonly AssetItem[]>([]);
  const assetsRef = useRef<readonly AssetItem[]>([]);
  const pollFailuresRef = useRef(0);
  const pendingRemovalsRef = useRef(new Set<string>());
  /* W03 竞态保护：并发 refresh 只有最新一次可提交（guard），组件卸载后不再更新（mounted）。 */
  const requestGuardRef = useRef(new LatestRequestGuard());
  const mountedRef = useRef(true);

  useEffect(() => {
    assetsRef.current = assets;
  }, [assets]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const applyAssets = useCallback(
    (next: readonly AssetItem[], announce: boolean) => {
      if (announce) {
        for (const notice of detectAssetStatusNotices(
          assetsRef.current,
          next,
        )) {
          onStatus?.(notice);
        }
        /* 处理中资产收敛到终态后联动只读列表（初始装载 announce=false，不算转变）。 */
        if (hasSettledAssetTransition(assetsRef.current, next)) {
          onSettled?.();
        }
      }
      assetsRef.current = next;
      setAssets(next);
    },
    [onSettled, onStatus],
  );

  /* 启停已由服务端按成员持久化，刷新时不再用本地值覆盖服务端结果——
     否则在别处（或上一次失败的乐观更新）留下的陈旧开关会一直粘住。 */
  const refresh = useCallback(async () => {
    const isCurrent = requestGuardRef.current.begin();
    const next = await loadAssets(endpoint, { enableSpaceByDefault: true });
    /* 期间已有更新请求或组件已卸载 → 丢弃过期结果，不覆盖新状态。 */
    if (!isCurrent() || !mountedRef.current) return;
    applyAssets(next, true);
    pollFailuresRef.current = 0;
  }, [applyAssets, endpoint]);

  useEffect(() => {
    let active = true;
    void loadAssets(endpoint, { enableSpaceByDefault: true })
      .then((items) => {
        if (active) applyAssets(items, false);
      })
      .catch((reason: unknown) => {
        if (active) onError(toClientError(reason, '暂时无法读取资料。'));
      });
    return () => {
      active = false;
    };
  }, [applyAssets, endpoint, onError]);

  /*
   * 解析改为异步后（ADR-0010），上传返回时资产仍可能处于 processing。
   * 只在集合里确实存在待处理来源时轮询；刷新失败静默重试，因为网络抖动
   * 不会改变服务端解析事实，也不应覆盖更具体的上传或来源操作错误。
   */
  const hasProcessingAsset = assets.some(
    (asset) => asset.status === 'pending' || asset.status === 'processing',
  );
  useEffect(() => {
    if (!hasProcessingAsset) return;
    const timer = setInterval(() => {
      void refresh().catch(() => {
        pollFailuresRef.current += 1;
        if (pollFailuresRef.current === 3) {
          onError(
            new ResourceClientError(
              'unavailable',
              '暂时无法刷新来源处理进度，请检查网络后重试。',
            ),
          );
        }
      });
    }, 2_000);
    return () => clearInterval(timer);
  }, [hasProcessingAsset, onError, refresh]);

  const patch = useCallback(
    (id: string, update: (asset: AssetItem) => AssetItem) => {
      setAssets((current) =>
        current.map((asset) => (asset.id === id ? update(asset) : asset)),
      );
    },
    [],
  );

  /* 乐观翻转后再落库：失败时回滚到服务端仍然持有的值，不把界面停在假状态。
     mutationId 每次点击生成一次，让重试被认成同一次切换而不是又翻回去。 */
  const toggle = useCallback(
    (asset: AssetItem) => {
      const next = !asset.enabled;
      patch(asset.id, (item) => ({ ...item, enabled: next }));
      void setAssetEnabled({
        assetId: asset.id,
        enabled: next,
        mutationId: crypto.randomUUID(),
      })
        .then((confirmed) => {
          patch(asset.id, (item) => ({ ...item, enabled: confirmed }));
        })
        .catch((reason: unknown) => {
          patch(asset.id, (item) => ({ ...item, enabled: asset.enabled }));
          onError(toClientError(reason, '暂时无法更新来源。'));
        });
    },
    [onError, patch],
  );

  const rename = useCallback(
    (asset: AssetItem, displayName: string) => {
      patch(asset.id, (item) => ({ ...item, label: displayName }));
      void renameAsset({ assetId: asset.id, displayName }).catch(
        (reason: unknown) => {
          patch(asset.id, (item) => ({ ...item, label: asset.label }));
          onError(toClientError(reason, '暂时无法重命名来源。'));
        },
      );
    },
    [onError, patch],
  );

  /* 删除是软删且不可撤销，所以不做乐观移除：等服务端确认后再从列表里去掉。 */
  const remove = useCallback(
    (asset: AssetItem) => {
      if (!mountedRef.current || pendingRemovalsRef.current.has(asset.id)) {
        return;
      }
      pendingRemovalsRef.current.add(asset.id);
      void deleteAsset(asset.id)
        .then(() => {
          if (!mountedRef.current) return;
          setAssets((current) =>
            (() => {
              const next = current.filter((item) => item.id !== asset.id);
              assetsRef.current = next;
              return next;
            })(),
          );
          onSettled?.();
        })
        .catch((reason: unknown) => {
          if (!mountedRef.current) return;
          onError(toClientError(reason, '暂时无法删除来源。'));
        })
        .finally(() => {
          pendingRemovalsRef.current.delete(asset.id);
        });
    },
    [onError, onSettled],
  );

  return { assets, setAssets, refresh, toggle, rename, remove };
}
