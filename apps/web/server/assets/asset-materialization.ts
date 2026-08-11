import 'server-only';

import {
  referencedAssetVersions,
  type AgentMessagePart,
  type AssetKind,
} from '@educanvas/agent-core';
import {
  buildAssetContext,
  type BuiltAssetContext,
  UnsupportedAgentInputModalityError,
} from '@educanvas/agent-runtime';
import { DrizzleAssetRepository } from '@educanvas/db';
import type { AnonymousIdentity } from '../identity/anonymous-identity';
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
}

export interface MaterializedAssetPlan extends BuiltAssetContext {
  nativeImages: readonly NativeAssetImage[];
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
  const materialized = await assets.materializeOwnedReferences({
    ownerSubjectId: input.identity.studentId,
    spaceId: input.spaceId,
    references,
  });
  let context: BuiltAssetContext;
  try {
    context = buildAssetContext({
      assets: materialized,
      capabilities: { nativeAssetKinds: input.nativeAssetKinds ?? [] },
    });
  } catch (error) {
    if (error instanceof UnsupportedAgentInputModalityError) {
      throw new UnsupportedAssetModalityError(error.kinds);
    }
    throw error;
  }
  return {
    ...context,
    nativeImages: await loadNativeImages(
      input.identity,
      input.spaceId,
      context,
    ),
  };
}

/**
 * 把 buildAssetContext 判定为「Provider 能原生读取」的引用读成内联字节。
 *
 * 只读已鉴权的不可变版本，storageKey 不离开服务端。非图片的原生模态目前没有
 * Provider 支持，出现即说明能力配置与实现不一致，直接失败而不是猜。
 */
async function loadNativeImages(
  identity: AnonymousIdentity,
  spaceId: string,
  context: BuiltAssetContext,
): Promise<readonly NativeAssetImage[]> {
  if (context.nativeReferences.length === 0) return [];
  if (context.nativeReferences.length > MAX_NATIVE_IMAGES) {
    throw new NativeAssetBudgetError('count');
  }
  const loaded = await Promise.all(
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
        } satisfies NativeAssetImage,
      };
    }),
  );
  const totalBytes = loaded.reduce((total, item) => total + item.byteLength, 0);
  if (totalBytes > MAX_NATIVE_IMAGE_BYTES) {
    throw new NativeAssetBudgetError('bytes');
  }
  return loaded.map((item) => item.image);
}

/**
 * K12 v1 的文本兼容物化边界。当前函数有意只返回字符串：文档通过受控提取文本
 * 进入 Prompt，图片等原生引用会明确失败而不是静默丢弃。它不代表平台已经具备
 * 原生全模态输入；后续由通用 Agent Runtime 返回结构化 ModelInputPart，并在
 * Provider Adapter 内解析已授权的不可变 Asset 版本。
 */
export async function materializeAssetContext(input: {
  identity: AnonymousIdentity;
  spaceId: string;
  parts: readonly AgentMessagePart[];
}): Promise<string> {
  return (await materializeAssetContextPlan(input)).text;
}
