import 'server-only';

import { createHash } from 'node:crypto';
import { AssetAccessError, DrizzleAssetRepository } from '@educanvas/db';
import { z } from 'zod';
import type { AnonymousIdentity } from '../identity/anonymous-identity';
import { readStoredAssetBytes } from './asset-storage';

const assets = new DrizzleAssetRepository();

/**
 * D 阶段：MinerU 派生资源（index.md / images/）的鉴权读取（ADR-0026 决定 3）。
 * 每次请求重新校验用户 → Notebook → Asset → Version 权限，再把 manifest 声明
 * 的相对路径投影成对象存储 key 读取，不暴露任何私有位置信息。所有失败统一
 * 按 404 返回，不区分"无资产/无表示/无该资源/资源损坏"。
 */
export class AssetResourceError extends Error {
  constructor(
    readonly code: 'resource_not_found' | 'resource_unavailable',
    readonly status: 404 | 503,
  ) {
    super(code);
    this.name = 'AssetResourceError';
  }
}

const imageMimeTypeSchema = z.enum([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/bmp',
]);

/**
 * C3 写入的 manifest 结构（buildMineruManifest）。schemaVersion=1 固定；
 * 图片 MIME 只接受白名单（C2 图片扩展名白名单的镜像），响应头不被污染。
 */
const manifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    producer: z.literal('mineru'),
    markdown: z.object({
      relativePath: z.string().min(1).max(255),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
      byteSize: z.number().int().nonnegative(),
      mimeType: z.literal('text/markdown'),
    }),
    images: z
      .array(
        z.object({
          relativePath: z.string().min(1).max(255),
          sha256: z.string().regex(/^[a-f0-9]{64}$/),
          byteSize: z.number().int().nonnegative(),
          mimeType: imageMimeTypeSchema,
          position: z.number().int().nonnegative(),
        }),
      )
      .max(500),
  })
  .strict();

/** C3 布局：文本表示的对象固定是 derived/<jobId>/index.md。 */
const INDEX_MD_SUFFIX = '/index.md';

/**
 * 读取经所有权校验的派生资源。resourcePath 必须是 manifest 声明的相对路径
 * （index.md 或 images/<name>），读取后按 manifest 的 byteSize + sha256 核对，
 * 任何不一致都按不存在处理——不向调用方暴露存储内部细节。
 */
export async function readOwnedAssetResource(input: {
  identity: AnonymousIdentity;
  spaceId: string;
  assetId: string;
  resourcePath: string;
}): Promise<{ bytes: Uint8Array; mimeType: string }> {
  let representation;
  try {
    representation = await assets.loadOwnedTextRepresentation({
      ownerSubjectId: input.identity.studentId,
      spaceId: input.spaceId,
      assetId: input.assetId,
    });
  } catch (error) {
    if (error instanceof AssetAccessError) {
      throw new AssetResourceError('resource_not_found', 404);
    }
    throw error;
  }
  if (
    !representation ||
    representation.quality !== 'structured' ||
    representation.status !== 'ready'
  ) {
    /* degraded_plain_text 只有纯文本对象，没有派生资源。 */
    throw new AssetResourceError('resource_not_found', 404);
  }
  if (!representation.derivedStorageKey.endsWith(INDEX_MD_SUFFIX)) {
    throw new AssetResourceError('resource_unavailable', 503);
  }
  const prefix = representation.derivedStorageKey.slice(
    0,
    -INDEX_MD_SUFFIX.length,
  );

  let manifest: z.infer<typeof manifestSchema>;
  try {
    const manifestBytes = await readStoredAssetBytes(`${prefix}/manifest.json`);
    const parsed = manifestSchema.safeParse(
      JSON.parse(new TextDecoder().decode(manifestBytes)),
    );
    if (!parsed.success) throw new Error('asset_manifest_invalid');
    manifest = parsed.data;
  } catch {
    throw new AssetResourceError('resource_not_found', 404);
  }

  const declared =
    manifest.markdown.relativePath === input.resourcePath
      ? {
          relativePath: manifest.markdown.relativePath,
          sha256: manifest.markdown.sha256,
          byteSize: manifest.markdown.byteSize,
          mimeType: 'text/markdown; charset=utf-8',
        }
      : manifest.images.find(
          (image) => image.relativePath === input.resourcePath,
        );
  if (!declared) {
    throw new AssetResourceError('resource_not_found', 404);
  }

  let bytes: Buffer;
  try {
    bytes = await readStoredAssetBytes(`${prefix}/${declared.relativePath}`);
  } catch {
    throw new AssetResourceError('resource_not_found', 404);
  }
  if (
    bytes.byteLength !== declared.byteSize ||
    createHash('sha256').update(bytes).digest('hex') !== declared.sha256
  ) {
    throw new AssetResourceError('resource_not_found', 404);
  }
  return { bytes, mimeType: declared.mimeType };
}
