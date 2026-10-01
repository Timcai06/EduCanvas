import 'server-only';

import { createHash } from 'node:crypto';
import { readStoredAssetBytes } from './asset-storage';
import type { AssetPreview } from '@/features/assets/asset-preview-contract';
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

/**
 * D04：转录文本读取——内容权威是 transcription representation 的对象存储
 * （旧列仅保留兼容镜像）；仅有旧字段、对象缺失或校验失败时按冻结规则回退
 * transcriptionText。对象读取失败不向浏览器泄露内部路径或错误细节。
 */
export async function resolveTranscriptionText(
  version: OwnedStoredAssetVersion,
): Promise<string | null> {
  const representation = version.transcriptionRepresentation;
  if (representation && representation.status === 'ready') {
    try {
      const bytes = await readStoredAssetBytes(
        representation.derivedStorageKey,
      );
      const checksum = createHash('sha256').update(bytes).digest('hex');
      if (checksum !== representation.checksum) {
        throw new Error('asset_representation_checksum_mismatch');
      }
      return new TextDecoder().decode(bytes);
    } catch {
      return version.transcriptionText;
    }
  }
  return version.transcriptionText;
}

/** 原网页只投影已鉴权的提取正文，不执行 HTML；派生物损坏时回退旧镜像。 */
export async function projectWebpageTextPreview(
  version: OwnedStoredAssetVersion,
): Promise<AssetPreview> {
  const representation = version.textRepresentation;
  let content = version.extractedText ?? '';
  if (
    representation?.status === 'ready' &&
    representation.mimeType === 'text/plain'
  ) {
    try {
      const bytes = await readStoredAssetBytes(
        representation.derivedStorageKey,
      );
      if (
        createHash('sha256').update(bytes).digest('hex') ===
        representation.checksum
      ) {
        content = new TextDecoder().decode(bytes);
      }
    } catch {
      /* 旧资产及派生物缺失时仍可读已落库的提取正文。 */
    }
  }
  return {
    kind: 'text',
    fileName: version.displayName,
    mimeType: 'text/plain',
    content: content.slice(0, 120_000),
  };
}
