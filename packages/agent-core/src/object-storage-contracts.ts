/**
 * 对象存储 Port 契约(ADR-0012)。媒体产物二进制经本 Port 写入,数据库只保存
 * key 与 sha-256 校验和。契约保持浏览器安全(无 node 依赖):校验和计算属于
 * 适配器职责,这里只定义形状与 key 纪律。
 */

/**
 * key 纪律:小写字母/数字开头,只允许 [a-z0-9/_.-],最长 1024;
 * 禁止 `..` 段与首尾斜杠——key 是逻辑标识,路径语义由适配器自行映射,
 * 这里从源头排除目录穿越的表达能力。
 */
const OBJECT_KEY_PATTERN = /^[a-z0-9][a-z0-9/_.-]{0,1023}$/;

export function isValidObjectKey(key: string): boolean {
  if (!OBJECT_KEY_PATTERN.test(key)) return false;
  if (key.endsWith('/')) return false;
  return key.split('/').every((segment) => segment !== '' && segment !== '..' && segment !== '.');
}

export interface StoredObject {
  key: string;
  /** sha-256 十六进制;与 artifact_versions.checksum 同一口径。 */
  checksum: string;
  sizeBytes: number;
}

export class ObjectStorageError extends Error {
  constructor(
    readonly code:
      | 'invalid_key'
      | 'object_not_found'
      | 'checksum_mismatch'
      | 'storage_unavailable',
    message: string,
  ) {
    super(message);
    this.name = 'ObjectStorageError';
  }
}

/**
 * 使用边界:put 幂等覆盖同 key;read 必须校验完整性,损坏对象以
 * checksum_mismatch 失败而不是返回坏字节;调用方负责在业务事务内
 * 持久化返回的 checksum。
 */
export interface ObjectStoragePort {
  put(input: {
    key: string;
    bytes: Uint8Array;
    contentType?: string;
  }): Promise<StoredObject>;
  read(key: string): Promise<Uint8Array>;
  delete(key: string): Promise<void>;
}
