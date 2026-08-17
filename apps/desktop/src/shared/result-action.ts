import type { DesktopResultTarget } from './chat-history';

export type DesktopOpenResult = { ok: true } | { ok: false; message: string };
export type DesktopImagePreviewResult =
  { ok: true; dataUrl: string } | { ok: false; message: string };

const boundedId = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 300;

function safeWebUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2_048) return false;
  try {
    const url = new URL(value);
    return (
      ['http:', 'https:'].includes(url.protocol) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

/** IPC 边界只接受卡片能够产生的受限资源身份；任意 URL 不得进入 main。 */
export function isDesktopResultTarget(
  value: unknown,
): value is DesktopResultTarget {
  if (!value || typeof value !== 'object') return false;
  const target = value as Record<string, unknown>;
  if (target.kind === 'knowledge') {
    return (
      boundedId(target.sourceId) &&
      boundedId(target.documentId) &&
      boundedId(target.chunkId) &&
      (target.pageStart === null ||
        (Number.isSafeInteger(target.pageStart) &&
          Number(target.pageStart) >= 1)) &&
      (target.pageEnd === null ||
        (Number.isSafeInteger(target.pageEnd) && Number(target.pageEnd) >= 1))
    );
  }
  if (target.kind === 'asset')
    return boundedId(target.assetId) && boundedId(target.assetVersionId);
  if (target.kind === 'web') {
    return (
      boundedId(target.assetId) &&
      boundedId(target.assetVersionId) &&
      safeWebUrl(target.url)
    );
  }
  if (target.kind === 'artifact')
    return (
      boundedId(target.artifactId) &&
      (target.versionId === null || boundedId(target.versionId))
    );
  return false;
}
