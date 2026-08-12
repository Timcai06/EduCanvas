import 'server-only';

import { createHash } from 'node:crypto';
import {
  referencedAssetVersions,
  type AgentMessagePart,
  type AssetKind,
} from '@educanvas/agent-core';
import {
  buildAssetContext,
  type BuiltAssetContext,
  type MaterializedAssetInput,
  UnsupportedAgentInputModalityError,
} from '@educanvas/agent-runtime';
import { DrizzleAssetRepository } from '@educanvas/db';
import type { AnonymousIdentity } from '../identity/anonymous-identity';
import {
  INDEX_MD_SUFFIX,
  loadDerivedManifest,
  type DerivedManifest,
} from './asset-derived-resources';
import { readStoredAssetBytes } from './asset-storage';

const assets = new DrizzleAssetRepository();

export class UnsupportedAssetModalityError extends UnsupportedAgentInputModalityError {}

/**
 * 一轮最多内联的原生图片张数与总字节。
 *
 * 图片不进文本预算（`maxCharacters`）,所以必须在这里单独设界，否则一次勾选十几张
 * 图就能把请求体撑到供应商拒绝或超时。超出部分明确失败而不是静默截断——静默丢图
 * 会让模型基于不完整材料作答，比报错更糟。
 */
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
export interface NativeAssetImage {
  versionId: string;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  /** 不带 `data:` 前缀的裸 base64。 */
  data: string;
  /**
   * 派生图在 derived/<jobId>/ 下的相对路径（如 images/fig1.png），用于 part id
   * 区分同一版本的多个派生图；用户上传的原生图为 null。
   */
  resourcePath: string | null;
}

export interface MaterializedAssetPlan extends BuiltAssetContext {
  nativeImages: readonly NativeAssetImage[];
}

/**
 * ADR-0026 第 6 节：文档仍在转换（processing）或转换失败（failed）时，
 * 当前 Turn 不得静默带入空文本伪装成功，必须明确失败。
 */
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

/** ADR-0026 第 5 节：派生文件（文本或图片）与记录 checksum 不符，视为对象存储数据损坏。 */
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

/**
 * ADR-0026 第 5/6 节：按表示质量决定文本源。
 * - processing/failed → 明确失败，禁止静默带入；
 * - structured 且带派生文件 → 读对象存储 Markdown 并核对 checksum；
 * - degraded / 无派生表示 / structured 但无派生文件（理论回退）→ extractedText
 *   兼容（mirror 与派生文件同事务写入，内容等价）。
 */
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

/**
 * 返回聚合文本和逐AssetVersion片段。调用方必须把逐段引用写入Context Snapshot，
 * 不能只把拼接后的字符串交给模型而丢失实际使用版本。
 */
export async function materializeAssetContextPlan(input: {
  identity: AnonymousIdentity;
  spaceId: string;
  parts: readonly AgentMessagePart[];
  /** 由组合根从模型网关配置注入；缺省视为纯文本 Provider。 */
  nativeAssetKinds?: readonly AssetKind[];
}): Promise<MaterializedAssetPlan> {
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
    ownerSubjectId: input.identity.studentId,
    spaceId: input.spaceId,
    references,
  });
  /* ADR-0026 第 5/6 节：按表示质量解析文本源——processing/failed 明确失败，
     structured 读派生 Markdown 并核对 checksum（有界截断由 buildAssetContext 执行）。 */
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
      capabilities: { nativeAssetKinds: input.nativeAssetKinds ?? [] },
    });
  } catch (error) {
    if (error instanceof UnsupportedAgentInputModalityError) {
      throw new UnsupportedAssetModalityError(error.kinds);
    }
    throw error;
  }
  /* ADR-0026 决定 3：structured 派生文件（docx 内嵌图）也是原生输入候选，
     与用户上传图共享同一份预算。prefix 从对象布局推导；布局不符时跳过图片
     （文本读取不依赖 index.md 布局，图片路径不可推导就不强推）。 */
  const derivedNativeSources = enriched.flatMap((asset) => {
    const storageKey = asset.derivedTextSource?.storageKey;
    if (!storageKey?.endsWith(INDEX_MD_SUFFIX)) return [];
    return [
      {
        versionId: asset.reference.versionId,
        prefix: storageKey.slice(0, -INDEX_MD_SUFFIX.length),
      },
    ];
  });
  return {
    ...context,
    nativeImages: await loadNativeImages(
      input.identity,
      input.spaceId,
      context,
      derivedNativeSources,
      input.nativeAssetKinds ?? [],
    ),
  };
}

/**
 * 派生图在 manifest 中的声明（读取前未知字节，只读清单做预算预检）。
 * manifest 缺失或损坏是 C3 双写异常，与文本 checksum 不符同样视为数据损坏。
 */
interface DerivedImageDeclaration {
  versionId: string;
  prefix: string;
  relativePath: string;
  sha256: string;
  byteSize: number;
  mimeType: string;
}

async function loadDerivedImageDeclarations(
  sources: readonly { versionId: string; prefix: string }[],
): Promise<readonly DerivedImageDeclaration[]> {
  if (sources.length === 0) return [];
  const perAsset = await Promise.all(
    sources.map(async (source) => {
      let manifest: DerivedManifest;
      try {
        manifest = await loadDerivedManifest(source.prefix);
      } catch {
        throw new DerivedTextIntegrityError(source.versionId);
      }
      return manifest.images
        .filter((image) => NATIVE_IMAGE_MIME_TYPES.has(image.mimeType))
        .sort((a, b) => a.position - b.position)
        .map((image) => ({ ...source, ...image }));
    }),
  );
  return perAsset.flat();
}

/**
 * 读取用户原生图（nativeReferences）的字节。单独拆出使派生图读取与其并行：
 * manifest 是轻量 JSON，图片字节在通过 count 预算后才读取，避免超限白读。
 */
async function loadUserNativeImages(
  identity: AnonymousIdentity,
  spaceId: string,
  context: BuiltAssetContext,
): Promise<{ byteLength: number; image: NativeAssetImage }[]> {
  if (context.nativeReferences.length === 0) return [];
  return Promise.all(
    context.nativeReferences.map(async (reference) => {
      const version = await assets.loadOwnedCurrentStoredVersion({
        ownerSubjectId: identity.studentId,
        spaceId,
        assetId: reference.assetId,
      });
      if (!NATIVE_IMAGE_MIME_TYPES.has(version.mimeType)) {
        throw new UnsupportedAssetModalityError([reference.kind]);
      }
      const bytes = await readStoredAssetBytes(version.storageKey);
      return {
        byteLength: bytes.byteLength,
        image: {
          versionId: reference.versionId,
          mimeType: version.mimeType as NativeAssetImage['mimeType'],
          data: Buffer.from(bytes).toString('base64'),
          resourcePath: null,
        } satisfies NativeAssetImage,
      };
    }),
  );
}

/**
 * 把 buildAssetContext 判定为「Provider 能原生读取」的引用读成内联字节。
 *
 * 只读已鉴权的不可变版本，storageKey 不离开服务端。非图片的原生模态目前没有
 * Provider 支持，出现即说明能力配置与实现不一致，直接失败而不是猜。
 *
 * 派生图（docx 内嵌图）与用户上传图共享同一份 count/bytes 预算：一次勾选多份
 * 文档时，文档文本按段计预算，图片同样有界，超出明确失败而不是静默丢图。
 */
async function loadNativeImages(
  identity: AnonymousIdentity,
  spaceId: string,
  context: BuiltAssetContext,
  derivedNativeSources: readonly { versionId: string; prefix: string }[],
  nativeAssetKinds: readonly AssetKind[],
): Promise<readonly NativeAssetImage[]> {
  /* 用户图数量读取前已知，先做 count 预检避免超限白读；派生图数量在
     manifest 解析后才知，合并后的完整检查在声明就绪时执行。 */
  if (context.nativeReferences.length > MAX_NATIVE_IMAGES) {
    throw new NativeAssetBudgetError('count');
  }
  const [userImages, declarations] = await Promise.all([
    loadUserNativeImages(identity, spaceId, context),
    nativeAssetKinds.includes('image')
      ? loadDerivedImageDeclarations(derivedNativeSources)
      : Promise.resolve([] as readonly DerivedImageDeclaration[]),
  ]);
  if (userImages.length + declarations.length > MAX_NATIVE_IMAGES) {
    throw new NativeAssetBudgetError('count');
  }
  const derivedImages = await Promise.all(
    declarations.map(async (declared) => {
      const bytes = await readStoredAssetBytes(
        `${declared.prefix}/${declared.relativePath}`,
      );
      if (
        bytes.byteLength !== declared.byteSize ||
        createHash('sha256').update(bytes).digest('hex') !== declared.sha256
      ) {
        throw new DerivedTextIntegrityError(declared.versionId);
      }
      return {
        byteLength: bytes.byteLength,
        image: {
          versionId: declared.versionId,
          mimeType: declared.mimeType as NativeAssetImage['mimeType'],
          data: Buffer.from(bytes).toString('base64'),
          resourcePath: declared.relativePath,
        } satisfies NativeAssetImage,
      };
    }),
  );
  const loaded = [...userImages, ...derivedImages];
  const totalBytes = loaded.reduce((total, item) => total + item.byteLength, 0);
  if (totalBytes > MAX_NATIVE_IMAGE_BYTES) {
    throw new NativeAssetBudgetError('bytes');
  }
  return loaded.map((item) => item.image);
}

/**
 * K12 v1 的文本兼容物化边界。当前函数有意只返回字符串：文档按 ADR-0026
 * 以有界 Markdown（structured）或兼容提取文本（degraded/旧资产）进入 Prompt，
 * 图片等原生引用会明确失败而不是静默丢弃。它不代表平台已经具备原生全模态输入；
 * 完整结构化输入与 Context Snapshot 冻结请走 materializeAssetContextPlan。
 */
export async function materializeAssetContext(input: {
  identity: AnonymousIdentity;
  spaceId: string;
  parts: readonly AgentMessagePart[];
}): Promise<string> {
  return (await materializeAssetContextPlan(input)).text;
}
