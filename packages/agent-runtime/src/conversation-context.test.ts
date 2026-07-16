import { describe, expect, it } from 'vitest';
import { buildConversationContext } from './conversation-context';

describe('buildConversationContext', () => {
  const history = [
    { id: 'm1', role: 'user' as const, content: '第一问' },
    { id: 'm2', role: 'assistant' as const, content: '第一答' },
    { id: 'm3', role: 'user' as const, content: '第二问' },
    { id: 'm4', role: 'assistant' as const, content: '第二答' },
  ];

  it('保留最新的完整消息并恢复为时间顺序', () => {
    expect(buildConversationContext(history, { maxMessages: 2 })).toEqual({
      version: 'conversation-context-v1',
      messages: [
        { role: 'user', content: '第二问' },
        { role: 'assistant', content: '第二答' },
      ],
      includedMessageIds: ['m3', 'm4'],
      omittedMessageCount: 2,
      characterCount: 6,
    });
  });

  it('不截断超过字符预算的消息', () => {
    expect(
      buildConversationContext(history, {
        maxMessages: 10,
        maxCharacters: 4,
      }),
    ).toMatchObject({
      messages: [{ role: 'assistant', content: '第二答' }],
      includedMessageIds: ['m4'],
      omittedMessageCount: 3,
    });
  });

  it('忽略空白消息且不改变输入', () => {
    const input = [
      ...history,
      { id: 'empty', role: 'assistant' as const, content: '   ' },
    ];
    const snapshot = buildConversationContext(input);
    expect(snapshot.includedMessageIds).toEqual(['m1', 'm2', 'm3', 'm4']);
    expect(input.at(-1)?.content).toBe('   ');
  });
});
