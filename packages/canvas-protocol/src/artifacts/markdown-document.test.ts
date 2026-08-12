import { describe, expect, it } from 'vitest';
import {
  MARKDOWN_DOCUMENT_KIND,
  MARKDOWN_DOCUMENT_MAX_CHARS,
  markdownDocumentContentSchema,
} from './markdown-document';

describe('markdownDocumentContentSchema', () => {
  it('接受合法 Markdown 文档与可选会话标识', () => {
    expect(
      markdownDocumentContentSchema.safeParse({
        contentVersion: 1,
        markdown: '# 一元二次方程',
        sourceConversationId: '10000000-0000-4000-8000-000000000001',
        generatedByModel: true,
      }).success,
    ).toBe(true);
  });

  it('拒绝超长、非法会话标识与未知字段', () => {
    expect(
      markdownDocumentContentSchema.safeParse({
        contentVersion: 1,
        markdown: 'x'.repeat(MARKDOWN_DOCUMENT_MAX_CHARS + 1),
        generatedByModel: false,
      }).success,
    ).toBe(false);
    expect(
      markdownDocumentContentSchema.safeParse({
        contentVersion: 1,
        markdown: '# 文档',
        sourceConversationId: 'conversation:untrusted',
        generatedByModel: false,
      }).success,
    ).toBe(false);
    expect(
      markdownDocumentContentSchema.safeParse({
        contentVersion: 1,
        markdown: '# 文档',
        generatedByModel: false,
        html: '<p>raw</p>',
      }).success,
    ).toBe(false);
  });

  it('定义固定 kind 语义', () => {
    expect(MARKDOWN_DOCUMENT_KIND).toBe('document.markdown.v1');
  });
});
