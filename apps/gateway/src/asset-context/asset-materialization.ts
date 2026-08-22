import { createHash } from 'node:crypto';
import type { AgentMessagePart, AssetKind } from '@educanvas/agent-core';
import { referencedAssetVersions } from '@educanvas/agent-core';
import {
  buildAssetContext,
  type BuiltAssetContext,
  type MaterializedAssetInput,
  UnsupportedAgentInputModalityError,
} from '@educanvas/agent-runtime';
import { DrizzleAssetRepository, readStoredAssetBytes } from '@educanvas/db';

const assets = new DrizzleAssetRepository();

/**
 * Gateway 端 asset_ref 物化（DP10）。
 *
 * 从可信 Turn 输入中提取 asset_ref 引用，按 bearer 主体 + notebook 归属读取
 * 不可变版本：PDF/文档 → 派生 Markdown（核对 checksum）或兼容提取文本；
 * 图片 → 读出字节交给 Provider 原生消费。文本语义与
 * apps/web/server/assets/asset-materialization.ts 保持一致，仅鉴权主体
 * 从 AnonymousIdentity 换成 gateway 的 trustedSubjectId。
 *
 * 派生内嵌图（docx/PDF 里的图）暂不在桌面链路物化：桌面输入是单张图片或
 * 整份 PDF 文本，原生图预算只覆盖用户上传图。
 */

export class UnsupportedAssetModalityError extends UnsupportedAgentInputModalityError {}

/** 一轮最多内联的原生图片张数与总字节（与 web 同预算）。 */
export const MAX_NATIVE_IMAGES = 12;
export const MAX_NATIVE_IMAGE_BYTES = 24 * 1024 * 1024;

const NATIVE_IMAGE_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
]);

export class NativeAssetBudgetError extends Error {
  readonly code = 'native_asset_budget_exceeded';

  constructor(readonly reason: 'count' | 'bytes') {
    super(`原生输入超出预算：${reason}`);
    this.name = 'NativeAssetBudgetError';
  }
}

/** 已读出字节、可直接进入 Provider 请求的原生输入。 */
export interface GatewayNativeAssetImage {
  versionId: string;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  /** 不带 `data:` 前缀的裸 base64。 */
  data: string;
}

export interface GatewayMaterializedAssetPlan extends BuiltAssetContext {
  nativeImages: readonly GatewayNativeAssetImage[];
}

export class AssetVersionIntegrityError extends Error {
  readonly code = 'asset_version_integrity';

  constructor(readonly versionId: string) {
    super('资产版本在物化期间发生变化，本轮不能使用该资料');
    this.name = 'AssetVersionIntegrityError';
  }
}

export function requireReferencedStoredVersion(
  reference: { assetId: string; versionId: string },
  stored: { assetId: string; versionId: string },
): void {
  if (
    stored.assetId !== reference.assetId ||
    stored.versionId !== reference.versionId
  ) {
    throw new AssetVersionIntegrityError(reference.versionId);
  }
}

/** ADR-0026 第 6 节：文档仍在转换或转换失败时，本轮不得静默带入空文本。 */
export class AssetTextNotReadyError extends Error {
  readonly code = 'asset_text_not_ready';

  constructor(
    readonly reason: 'processing' | 'failed',
    readonly versionId: string,
  ) {
    super(
      reason === 'processing'
        ? '文档仍在转换，本轮暂不能作为资料使用'
        : '文档转换失败，本轮不能作为资料使用',
    );
    this.name = 'AssetTextNotReadyError';
  }
}

/** ADR-0026 第 5 节：派生文件与记录 checksum 不符，视为对象存储数据损坏。 */
export class DerivedTextIntegrityError extends Error {
  readonly code = 'derived_text_integrity';

  constructor(readonly versionId: string) {
    super('派生数据校验失败，本轮不能使用该资料');
    this.name = 'DerivedTextIntegrityError';
  }
}

export type AssetTextSourceDecision =
  | { kind: 'not_ready'; reason: 'processing' | 'failed' }
  | { kind: 'read_derived'; storageKey: string; checksumSha256: string }
  | { kind: 'compat_text' };

/** ADR-0026 第 5/6 节：按表示质量决定文本源，与 web 物化层同规则。 */
export function planAssetTextSource(asset: {
  textRepresentation: MaterializedAssetInput['textRepresentation'];
  derivedTextSource: MaterializedAssetInput['derivedTextSource'];
}): AssetTextSourceDecision {
  const quality = asset.textRepresentation?.quality;
  if (quality === 'processing') {
    return { kind: 'not_ready', reason: 'processing' };
  }
  if (quality === 'failed') {
    return { kind: 'not_ready', reason: 'failed' };
  }
  if (asset.derivedTextSource) {
    return {
      kind: 'read_derived',
      storageKey: asset.derivedTextSource.storageKey,
      checksumSha256: asset.derivedTextSource.checksumSha256,
    };
  }
  return { kind: 'compat_text' };
}

export interface GatewayAssetMaterializer {
  materializeOwnedReferences(input: {
    trustedSubjectId: string;
    notebookId: string;
    parts: readonly AgentMessagePart[];
    nativeAssetKinds: readonly AssetKind[];
  }): Promise<GatewayMaterializedAssetPlan>;
}

export class DrizzleGatewayAssetMaterializer implements GatewayAssetMaterializer {
  async materializeOwnedReferences(input: {
    trustedSubjectId: string;
    notebookId: string;
    parts: readonly AgentMessagePart[];
    nativeAssetKinds: readonly AssetKind[];
  }): Promise<GatewayMaterializedAssetPlan> {
    const references = referencedAssetVersions(input.parts);
    if (references.length === 0) {
      return {
        text: '',
        textSegments: [],
        nativeReferences: [],
        nativeImages: [],
      };
    }
    const owned = await assets.materializeOwnedReferences({
      ownerSubjectId: input.trustedSubjectId,
      spaceId: input.notebookId,
      references,
    });
    const enriched: MaterializedAssetInput[] = await Promise.all(
      owned.map(async (asset) => {
        const decision = planAssetTextSource(asset);
        switch (decision.kind) {
          case 'not_ready':
            throw new AssetTextNotReadyError(
              decision.reason,
              asset.reference.versionId,
            );
          case 'read_derived': {
            const bytes = await readStoredAssetBytes(decision.storageKey);
            const markdown = new TextDecoder().decode(bytes);
            const digest = createHash('sha256')
              .update(new TextEncoder().encode(markdown))
              .digest('hex');
            if (digest !== decision.checksumSha256) {
              throw new DerivedTextIntegrityError(asset.reference.versionId);
            }
            return { ...asset, derivedMarkdown: markdown };
          }
          case 'compat_text':
            return { ...asset, derivedMarkdown: null };
        }
      }),
    );
    let context: BuiltAssetContext;
    try {
      context = buildAssetContext({
        assets: enriched,
        capabilities: { nativeAssetKinds: input.nativeAssetKinds },
      });
    } catch (error) {
      if (error instanceof UnsupportedAgentInputModalityError) {
        throw new UnsupportedAssetModalityError(error.kinds);
      }
      throw error;
    }
    return {
      ...context,
      nativeImages: await loadUserNativeImages(input, context),
    };
  }
}

/**
 * 把 buildAssetContext 判定为「Provider 能原生读取」的用户上传引用读成内联字节。
 * 只读已鉴权的不变版本；非图片原生模态目前没有 Provider 支持，出现即明确失败。
 */
async function loadUserNativeImages(
  input: {
    trustedSubjectId: string;
    notebookId: string;
  },
  context: BuiltAssetContext,
): Promise<readonly GatewayNativeAssetImage[]> {
  if (context.nativeReferences.length === 0) return [];
  if (context.nativeReferences.length > MAX_NATIVE_IMAGES) {
    throw new NativeAssetBudgetError('count');
  }
  const loaded = await Promise.all(
    context.nativeReferences.map(async (reference) => {
      const version = await assets.loadOwnedCurrentStoredVersion({
        ownerSubjectId: input.trustedSubjectId,
        spaceId: input.notebookId,
        assetId: reference.assetId,
      });
      /* 当前版本可能在首次鉴权读取后被并发替换；禁止把新字节标记成旧 versionId。 */
      requireReferencedStoredVersion(reference, version);
      if (!NATIVE_IMAGE_MIME_TYPES.has(version.mimeType)) {
        throw new UnsupportedAssetModalityError([reference.kind]);
      }
      const bytes = await readStoredAssetBytes(version.storageKey);
      return {
        byteLength: bytes.byteLength,
        image: {
          versionId: reference.versionId,
          mimeType: version.mimeType as GatewayNativeAssetImage['mimeType'],
          data: Buffer.from(bytes).toString('base64'),
        } satisfies GatewayNativeAssetImage,
      };
    }),
  );
  const totalBytes = loaded.reduce((total, item) => total + item.byteLength, 0);
  if (totalBytes > MAX_NATIVE_IMAGE_BYTES) {
    throw new NativeAssetBudgetError('bytes');
  }
  return loaded.map((item) => item.image);
}
