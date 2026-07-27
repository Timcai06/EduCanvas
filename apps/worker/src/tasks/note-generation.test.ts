import { describe, expect, it } from 'vitest';
import { noteContentSchema } from '@educanvas/canvas-protocol';
import {
  generateNoteContent,
  RULE_GENERATOR,
  RULE_REVISION_GENERATOR,
} from './note-generation';

const common = {
  title: '二次函数',
  gateway: null,
  traceId: 'trace:note',
  operationId: 'operation:note',
} as const;

describe('generateNoteContent', () => {
  it('无模型时从有界对话生成可校验的 Markdown', async () => {
    const result = await generateNoteContent({
      ...common,
      messages: [
        { role: 'user', content: '顶点式是什么？' },
        { role: 'assistant', content: 'y=a(x-h)^2+k。' },
      ],
    });

    expect(result.generatedBy).toBe(RULE_GENERATOR);
    expect(noteContentSchema.parse(result.content)).toMatchObject({
      contentVersion: 1,
      generatedByModel: false,
    });
    expect(result.content.markdown).toContain('顶点式是什么');
  });

  it('无模型修改保留原文并记录明确要求', async () => {
    const result = await generateNoteContent({
      ...common,
      messages: [],
      revision: {
        instruction: '补充一个例题',
        baseContent: {
          contentVersion: 1,
          markdown: '# 原笔记',
          generatedByModel: true,
        },
      },
    });

    expect(result.generatedBy).toBe(RULE_REVISION_GENERATOR);
    expect(result.content.markdown).toContain('# 原笔记');
    expect(result.content.markdown).toContain('补充一个例题');
    expect(result.content.generatedByModel).toBe(false);
  });
});
