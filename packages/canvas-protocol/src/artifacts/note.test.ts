import { describe, expect, it } from 'vitest';
import { NOTE_MARKDOWN_MAX_CHARS, noteContentSchema } from './note';

describe('noteContentSchema', () => {
  it('接受有界 Markdown 与可选来源会话', () => {
    expect(
      noteContentSchema.safeParse({
        contentVersion: 1,
        markdown: '# 勾股定理',
        sourceConversationId: '10000000-0000-4000-8000-000000000001',
        generatedByModel: false,
      }).success,
    ).toBe(true);
  });

  it('拒绝超长 Markdown、非法会话标识与未知字段', () => {
    expect(
      noteContentSchema.safeParse({
        contentVersion: 1,
        markdown: 'x'.repeat(NOTE_MARKDOWN_MAX_CHARS + 1),
        generatedByModel: true,
      }).success,
    ).toBe(false);
    expect(
      noteContentSchema.safeParse({
        contentVersion: 1,
        markdown: '',
        sourceConversationId: 'conversation:untrusted',
        generatedByModel: false,
      }).success,
    ).toBe(false);
    expect(
      noteContentSchema.safeParse({
        contentVersion: 1,
        markdown: '',
        generatedByModel: false,
        html: '<script />',
      }).success,
    ).toBe(false);
  });
});
