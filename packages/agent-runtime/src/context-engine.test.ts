import { describe, expect, it } from 'vitest';
import { buildAgentContext, ContextEngineInputError } from './context-engine';

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
});
