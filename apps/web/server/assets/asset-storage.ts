import 'server-only';

/**
 * Web 侧对象存储入口。核心实现已下沉到共享层 `@educanvas/db` 的
 * `asset-object-storage`（DP10：gateway 与 web 共用同一对象存储）；
 * 本文件保留 `server-only` 标记，阻止 Next.js 把存储逻辑打包进客户端。
 */
export {
  removeStoredAsset,
  removeStoredAssetByKey,
  readStoredAssetBytes,
  storeAssetBytes,
  type StoredAssetObject,
} from '@educanvas/db/asset-object-storage';
