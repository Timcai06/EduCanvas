import type {
  StructuredModelGateway,
  StructuredModelRequest,
} from '@educanvas/agent-core';
import { describe, expect, it, vi } from 'vitest';
import { noteContentSchema } from '@educanvas/canvas-protocol';
import {
  generateNoteContent,
  RULE_GENERATOR,
  RULE_REVISION_GENERATOR,
  NOTE_PROMPT_VERSION,
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

  it('模型生成提示包含受控 callout 语法', async () => {
    const generateStructured = vi.fn(
      async (_request: StructuredModelRequest<unknown>) => ({
        output: noteContentSchema.parse({
          contentVersion: 1,
          markdown: '> [!tip] 提示\n> 先配方。',
          generatedByModel: true,
        }),
        metadata: {} as never,
      }),
    );

    await generateNoteContent({
      ...common,
      gateway: { generateStructured } as StructuredModelGateway,
      messages: [],
    });

    const request = generateStructured.mock
      .calls[0]![0] as StructuredModelRequest<unknown>;
    expect(request.promptVersion).toBe(NOTE_PROMPT_VERSION);
    expect(request.messages[0]?.content).toContain('> [!note] 标题');
    expect(request.messages[0]?.content).toContain('warning、danger、example');
  });
});
