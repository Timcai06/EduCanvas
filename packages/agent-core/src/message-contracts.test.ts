import { describe, expect, it } from 'vitest';
import {
  agentMessageInputSchema,
  extractAgentMessageText,
  normalizeAgentMessageParts,
  referencedAssetKinds,
  referencedAssetVersions,
  type AgentMessagePart,
} from './message-contracts';

const parts = [
  { type: 'text', text: '  请分析这段视频\r\n并总结。  ' },
  {
    type: 'asset_ref',
    reference: {
      assetId: 'asset-video-1',
      versionId: 'version-video-1',
      kind: 'video',
    },
    usage: 'attachment',
  },
] satisfies AgentMessagePart[];

describe('generic multimodal message contracts', () => {
  it('同一消息可以组合文本与任意模态资产引用', () => {
    const message = agentMessageInputSchema.parse({
      clientMessageId: 'message-1',
      parts,
    });
    expect(referencedAssetKinds(message.parts)).toEqual(['video']);
    expect(referencedAssetVersions(message.parts)).toEqual([
      {
        assetId: 'asset-video-1',
        versionId: 'version-video-1',
        kind: 'video',
      },
    ]);
  });

  it('规范化文本但保持资产版本引用不变', () => {
    const normalized = normalizeAgentMessageParts(parts);
    expect(extractAgentMessageText(normalized)).toBe(
      '请分析这段视频\n并总结。',
    );
    expect(normalized[1]).toBe(parts[1]);
  });

  it('拒绝重复资产版本和供应商私有输入', () => {
    expect(
      agentMessageInputSchema.safeParse({
        clientMessageId: 'message-1',
        parts: [parts[1], parts[1]],
      }).success,
    ).toBe(false);
    expect(
      agentMessageInputSchema.safeParse({
        clientMessageId: 'message-2',
        parts,
        providerFileId: 'file-secret-provider-id',
      }).success,
    ).toBe(false);
  });

  it('允许生成产物作为对话输出引用', () => {
    expect(
      agentMessageInputSchema.safeParse({
        clientMessageId: 'message-3',
        parts: [
          {
            type: 'artifact_ref',
            artifactId: 'artifact-slide-1',
            versionId: 'artifact-version-1',
            kind: 'slide',
          },
        ],
      }).success,
    ).toBe(true);
  });
});
