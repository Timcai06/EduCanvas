import 'server-only';

import {
  referencedAssetVersions,
  type AgentMessagePart,
} from '@educanvas/agent-core';
import {
  buildAssetContext,
  UnsupportedAgentInputModalityError,
} from '@educanvas/agent-runtime';
import { DrizzleAssetRepository } from '@educanvas/db';
import type { AnonymousIdentity } from '../identity/anonymous-identity';

const assets = new DrizzleAssetRepository();

export class UnsupportedAssetModalityError extends UnsupportedAgentInputModalityError {}

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
  const references = referencedAssetVersions(input.parts);
  if (references.length === 0) return '';
  const materialized = await assets.materializeOwnedReferences({
    ownerSubjectId: input.identity.studentId,
    spaceId: input.spaceId,
    references,
  });
  try {
    return buildAssetContext({
      assets: materialized,
      // 当前OpenAI-compatible文本Adapter不声明视觉能力；未来由Provider配置注入。
      capabilities: { nativeAssetKinds: [] },
    }).text;
  } catch (error) {
    if (error instanceof UnsupportedAgentInputModalityError) {
      throw new UnsupportedAssetModalityError(error.kinds);
    }
    throw error;
  }
}
