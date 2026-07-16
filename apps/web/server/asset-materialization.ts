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
import type { AnonymousIdentity } from './anonymous-identity';

const assets = new DrizzleAssetRepository();

export class UnsupportedAssetModalityError extends UnsupportedAgentInputModalityError {}

/**
 * 当前 OpenAI-compatible Adapter 仍是文本输入，因此文档通过受控提取文本物化；
 * 图片不能被静默忽略，必须等视觉Provider/描述工具可用后再进入模型。
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
