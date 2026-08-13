import 'server-only';

import type { OwnedStoredAssetVersion } from '@educanvas/db';

/**
 * 把派生文本的持久事实收窄为浏览器安全投影。
 * 持久记录宣称可读但本次对象读取或完整性校验失败时，只把响应降级为
 * unavailable；不篡改数据库事实，也不继续冒充 structured。
 */
export function projectTextRepresentation(
  representation: NonNullable<OwnedStoredAssetVersion['textRepresentation']>,
  markdown: string | null,
) {
  const expectedReadable =
    representation.status === 'ready' &&
    (representation.quality === 'structured' ||
      representation.quality === 'degraded_plain_text');
  return {
    quality:
      expectedReadable && markdown === null
        ? ('unavailable' as const)
        : representation.quality,
    markdown: markdown ?? undefined,
    producer: representation.producer ?? null,
    producerVersion: representation.producerVersion ?? null,
  };
}
