// Colocated with the context-composition boundary it verifies.
import { describe, expect, it } from 'vitest';
import {
  buildAgentContext,
  ContextEngineInputError,
  MAX_ASSET_VERSIONS_PER_SEGMENT,
  type ContextSegment,
} from './context-engine';

const segment = (id: string, content: string, priority: number) => ({
  id,
  kind: 'conversation' as const,
  content,
  priority,
  messageId: `40000000-0000-4000-8000-${id.padStart(12, '0')}`,
});

describe('统一Context Engine', () => {
  it('按预算确定性选择并显式报告Memory unavailable', () => {
    const built = buildAgentContext({
      profileVersion: 'education-v1',
      profile: [
        {
          id: 'profile',
          kind: 'profile',
          content: '安全规则',
          priority: 100,
          required: true,
        },
      ],
      conversation: [segment('1', '旧消息', 10), segment('2', '新消息', 20)],
      sourcesAndAssets: [],
      memory: { status: 'unavailable', reason: 'not_implemented' },
      maxSegments: 2,
      maxCharacters: 100,
    });
    expect(built.segments.map((item) => item.id)).toEqual(['profile', '2']);
    expect(built.unavailableCapabilities).toEqual(['memory']);
    expect(built.material).toMatchObject({
      includedMessageIds: ['40000000-0000-4000-8000-000000000002'],
      omittedMessageCount: 1,
    });
  });

  it('tool call/result只能成对进入且保持原始顺序', () => {
    const built = buildAgentContext({
      profileVersion: 'general-v1',
      profile: [],
      conversation: [
        {
          id: 'call',
          kind: 'tool_call',
          content: 'call',
          priority: 50,
          pairKey: 'pair-1',
          messageId: '40000000-0000-4000-8000-000000000010',
        },
        {
          id: 'result',
          kind: 'tool_result',
          content: 'result',
          priority: 50,
          pairKey: 'pair-1',
          messageId: '40000000-0000-4000-8000-000000000011',
        },
        {
          id: 'orphan',
          kind: 'tool_call',
          content: 'orphan',
          priority: 100,
          pairKey: 'pair-2',
          messageId: '40000000-0000-4000-8000-000000000012',
        },
      ],
      sourcesAndAssets: [],
      memory: { status: 'unavailable', reason: 'disabled' },
    });
    expect(built.segments.map((item) => item.id)).toEqual(['call', 'result']);
    expect(built.material.omittedMessageCount).toBe(1);
    expect(built.material.builderVersion.length).toBeLessThanOrEqual(128);
  });

  it('必需Profile超预算时诚实失败', () => {
    expect(() =>
      buildAgentContext({
        profileVersion: 'education-v1',
        profile: [
          {
            id: 'profile',
            kind: 'profile',
            content: '必须保留',
            priority: 100,
            required: true,
          },
        ],
        conversation: [],
        sourcesAndAssets: [],
        memory: { status: 'unavailable', reason: 'disabled' },
        maxCharacters: 2,
      }),
    ).toThrow(ContextEngineInputError);
  });

  /**
   * R02：多张图片合并进同一条模型消息时，段必须登记全部 Asset Version 且保持
   * 消息内顺序。当前契约只有单值 assetVersionId，以下正向用例先红后绿。
   */
  describe('Context Segment 多 Asset 追溯', () => {
    const version = (n: number) =>
      `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

    it('一个 asset 段登记多个 Asset Version，material 按原始顺序保留全部版本', () => {
      const built = buildAgentContext({
        profileVersion: 'general-v1',
        profile: [],
        conversation: [],
        sourcesAndAssets: [
          {
            id: 'asset-native:multi',
            kind: 'asset',
            content: '[image]',
            priority: 95,
            required: true,
            assetVersionIds: [version(1), version(2), version(3)],
          } as ContextSegment,
        ],
        memory: { status: 'unavailable', reason: 'not_implemented' },
      });
      expect(built.segments).toHaveLength(1);
      expect(built.material.selectedAssetVersionIds).toEqual([
        version(1),
        version(2),
        version(3),
      ]);
    });

    it('文本单 Asset 段与多 Asset 段混合时按段顺序拼接全部版本', () => {
      const built = buildAgentContext({
        profileVersion: 'general-v1',
        profile: [],
        conversation: [],
        sourcesAndAssets: [
          {
            id: 'asset:text-1',
            kind: 'asset',
            content: '正文A',
            priority: 90,
            required: true,
            assetVersionId: version(10),
          },
          {
            id: 'asset:native-2',
            kind: 'asset',
            content: '[image]',
            priority: 95,
            required: true,
            assetVersionIds: [version(20), version(21)],
          } as ContextSegment,
          {
            id: 'asset:text-3',
            kind: 'asset',
            content: '正文B',
            priority: 88,
            required: true,
            assetVersionId: version(30),
          },
        ],
        memory: { status: 'unavailable', reason: 'not_implemented' },
      });
      // 引擎选中后按原始输入顺序还原，因此 material 顺序 = 段输入顺序 × 段内顺序。
      expect(built.material.selectedAssetVersionIds).toEqual([
        version(10),
        version(20),
        version(21),
        version(30),
      ]);
    });

    it('拒绝 assetVersionId 与 assetVersionIds 混用（歧义）', () => {
      expect(() =>
        buildAgentContext({
          profileVersion: 'general-v1',
          profile: [],
          conversation: [],
          sourcesAndAssets: [
            {
              id: 'asset-native:conflict',
              kind: 'asset',
              content: '[image]',
              priority: 95,
              required: true,
              assetVersionId: version(1),
              assetVersionIds: [version(2)],
            } as ContextSegment,
          ],
          memory: { status: 'unavailable', reason: 'not_implemented' },
        }),
      ).toThrow(ContextEngineInputError);
    });

    it('拒绝段内重复 Asset Version', () => {
      expect(() =>
        buildAgentContext({
          profileVersion: 'general-v1',
          profile: [],
          conversation: [],
          sourcesAndAssets: [
            {
              id: 'asset-native:dup',
              kind: 'asset',
              content: '[image]',
              priority: 95,
              required: true,
              assetVersionIds: [version(1), version(1)],
            } as ContextSegment,
          ],
          memory: { status: 'unavailable', reason: 'not_implemented' },
        }),
      ).toThrow(ContextEngineInputError);
    });

    it('拒绝跨段重复 Asset Version', () => {
      expect(() =>
        buildAgentContext({
          profileVersion: 'general-v1',
          profile: [],
          conversation: [],
          sourcesAndAssets: [
            {
              id: 'asset:text-1',
              kind: 'asset',
              content: '正文A',
              priority: 90,
              required: true,
              assetVersionId: version(1),
            },
            {
              id: 'asset:native-2',
              kind: 'asset',
              content: '[image]',
              priority: 95,
              required: true,
              assetVersionIds: [version(1), version(2)],
            } as ContextSegment,
          ],
          memory: { status: 'unavailable', reason: 'not_implemented' },
        }),
      ).toThrow(ContextEngineInputError);
    });

    it('拒绝空 Asset ID 与 source/asset 段零版本登记', () => {
      const expectRejected = (segment: ContextSegment) =>
        expect(() =>
          buildAgentContext({
            profileVersion: 'general-v1',
            profile: [],
            conversation: [],
            sourcesAndAssets: [segment],
            memory: { status: 'unavailable', reason: 'not_implemented' },
          }),
        ).toThrow(ContextEngineInputError);
      expectRejected({
        id: 'asset:empty-array',
        kind: 'asset',
        content: '正文',
        priority: 90,
        required: true,
        assetVersionIds: [],
      } as ContextSegment);
      expectRejected({
        id: 'asset:empty-string',
        kind: 'asset',
        content: '正文',
        priority: 90,
        required: true,
        assetVersionIds: [''],
      } as ContextSegment);
      expectRejected({
        id: 'asset:no-reference',
        kind: 'asset',
        content: '正文',
        priority: 90,
        required: true,
      });
    });

    it('拒绝单段 Asset Version 数量超限', () => {
      const tooMany = Array.from(
        { length: MAX_ASSET_VERSIONS_PER_SEGMENT + 1 },
        (_, index) => version(index + 1),
      );
      expect(() =>
        buildAgentContext({
          profileVersion: 'general-v1',
          profile: [],
          conversation: [],
          sourcesAndAssets: [
            {
              id: 'asset-native:too-many',
              kind: 'asset',
              content: '[image]',
              priority: 95,
              required: true,
              assetVersionIds: tooMany,
            } as ContextSegment,
          ],
          memory: { status: 'unavailable', reason: 'not_implemented' },
        }),
      ).toThrow(ContextEngineInputError);
    });
  });
});
