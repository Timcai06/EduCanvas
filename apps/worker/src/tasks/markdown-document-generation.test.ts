import type {
  StructuredModelGateway,
  StructuredModelRequest,
} from '@educanvas/agent-core';
import { markdownDocumentContentSchema } from '../../../../packages/canvas-protocol/src/artifacts/markdown-document';
import { describe, expect, it, vi } from 'vitest';
import {
  MARKDOWN_DOCUMENT_PROMPT_VERSION,
  MARKDOWN_DOCUMENT_REVISION_PROMPT_VERSION,
  MODEL_GENERATOR,
  MODEL_REVISION_GENERATOR,
  RULE_GENERATOR,
  RULE_REVISION_GENERATOR,
  generateMarkdownDocumentContent,
} from './markdown-document-generation';

const messages = [
  { role: 'user' as const, content: '二次函数顶点式的展开形式是什么？' },
  { role: 'assistant' as const, content: 'y=a(x-h)^2+k。' },
];

describe('generateMarkdownDocumentContent', () => {
  it('无网关时返回可校验文档初始版本并标记规则溯源', async () => {
    const result = await generateMarkdownDocumentContent({
      title: '二次函数',
      messages,
      gateway: null,
      traceId: 'trace-doc',
      operationId: 'job-doc',
    });
    expect(result.generatedBy).toBe(RULE_GENERATOR);
    expect(markdownDocumentContentSchema.parse(result.content)).toMatchObject({
      contentVersion: 1,
      generatedByModel: false,
    });
    expect(result.content.markdown).toContain('# 二次函数');
  });

  it('无网关时返回完整的新 revision 版本并保留修改要求', async () => {
    const result = await generateMarkdownDocumentContent({
      title: '二次函数',
      messages: [],
      gateway: null,
      traceId: 'trace-doc-revision',
      operationId: 'job-doc-revision',
      revision: {
        instruction: '补充顶点式实例',
        baseContent: {
          contentVersion: 1,
          markdown: '# 二次函数',
          generatedByModel: false,
        },
      },
    });
    expect(result.generatedBy).toBe(RULE_REVISION_GENERATOR);
    expect(result.content.generatedByModel).toBe(false);
    expect(result.content.markdown).toContain('补充顶点式实例');
  });

  it('有网关时调用 structured 生成并标记模型溯源', async () => {
    const generateStructured = vi.fn(
      async (request: StructuredModelRequest<unknown>) => ({
        output: markdownDocumentContentSchema.parse({
          contentVersion: 1,
          markdown: '# 二次函数\n\n- a=1\n- h=0\n- k=0',
          generatedByModel: true,
        }),
        metadata: {} as never,
      }),
    );
    const gateway = { generateStructured } as StructuredModelGateway;

    const result = await generateMarkdownDocumentContent({
      title: '二次函数',
      messages,
      gateway,
      traceId: 'trace-doc-model',
      operationId: 'job-doc-model',
    });

    expect(result.generatedBy).toBe(MODEL_GENERATOR);
    const request = generateStructured.mock
      .calls[0]![0] as StructuredModelRequest<unknown>;
    expect(request.taskAlias).toBe('artifact.generate');
    expect(request.modelAlias).toBe('structured');
    expect(request.promptVersion).toBe(MARKDOWN_DOCUMENT_PROMPT_VERSION);
    expect(result.content.markdown).toContain('a=1');
  });

  it('有网关 revision 时返回完整版本并透传修改指令', async () => {
    const generateStructured = vi.fn(
      async (request: StructuredModelRequest<unknown>) => ({
        output: markdownDocumentContentSchema.parse({
          contentVersion: 1,
          markdown: '# 二次函数\n\n## 修订版',
          generatedByModel: true,
        }),
        metadata: {} as never,
      }),
    );
    const gateway = { generateStructured } as StructuredModelGateway;

    const result = await generateMarkdownDocumentContent({
      title: '二次函数',
      messages,
      gateway,
      traceId: 'trace-doc-revision-model',
      operationId: 'job-doc-revision-model',
      revision: {
        instruction: '补充实例',
        baseContent: {
          contentVersion: 1,
          markdown: '# 二次函数\\n\\n- 原始',
          generatedByModel: true,
        },
      },
    });

    const request = generateStructured.mock
      .calls[0]![0] as StructuredModelRequest<unknown>;
    expect(request.promptVersion).toBe(
      MARKDOWN_DOCUMENT_REVISION_PROMPT_VERSION,
    );
    expect(request.messages.at(-1)?.content).toContain('修改要求');
    expect(request.messages.at(-1)?.content).toContain('补充实例');
    expect(request.messages.at(-1)?.content).toContain('当前文档');
    expect(result.generatedBy).toBe(MODEL_REVISION_GENERATOR);
  });

  it('有网关失败时不静默回退，向上抛错', async () => {
    const gateway = {
      generateStructured: vi.fn(async () => {
        throw new Error('provider down');
      }),
    } as StructuredModelGateway;

    await expect(
      generateMarkdownDocumentContent({
        title: '二次函数',
        messages,
        gateway,
        traceId: 'trace-doc-error',
        operationId: 'job-doc-error',
      }),
    ).rejects.toThrow('provider down');
  });

  it('有网关 revision 时返回模型生成并标记 revision 溯源', async () => {
    const generateStructured = vi.fn(async () => ({
      output: markdownDocumentContentSchema.parse({
        contentVersion: 1,
        markdown: '# 二次函数\n\n- revision',
        generatedByModel: true,
      }),
      metadata: {} as never,
    }));
    const gateway = { generateStructured } as StructuredModelGateway;

    const result = await generateMarkdownDocumentContent({
      title: '二次函数',
      messages,
      gateway,
      traceId: 'trace-doc-revision-model-2',
      operationId: 'job-doc-revision-model-2',
      revision: {
        instruction: '增强结论',
        baseContent: {
          contentVersion: 1,
          markdown: '# 二次函数',
          generatedByModel: true,
        },
      },
    });

    expect(result.generatedBy).toBe(MODEL_REVISION_GENERATOR);
  });

  it('有网关时校验模型输出不允许包含未解码的 \\n 字面量', async () => {
    const generateStructured = vi.fn(async () => ({
      output: markdownDocumentContentSchema.parse({
        contentVersion: 1,
        markdown: '# 二次函数\\\\n\\\\n- a=1',
        generatedByModel: true,
      }),
      metadata: {} as never,
    }));
    const gateway = { generateStructured } as StructuredModelGateway;

    await expect(
      generateMarkdownDocumentContent({
        title: '二次函数',
        messages,
        gateway,
        traceId: 'trace-doc-invalid-model',
        operationId: 'job-doc-invalid-model',
      }),
    ).rejects.toThrow('markdown_document_invalid_output');
  });

  it('即使同时有真实换行也拒绝其余坍塌的 Markdown 分块', async () => {
    const generateStructured = vi.fn(async () => ({
      output: markdownDocumentContentSchema.parse({
        contentVersion: 1,
        markdown: '# 主标题\n正文\\n\\n## 未解码小节',
        generatedByModel: true,
      }),
      metadata: {} as never,
    }));

    await expect(
      generateMarkdownDocumentContent({
        title: '混合换行',
        messages,
        gateway: { generateStructured } as StructuredModelGateway,
        traceId: 'trace-doc-mixed-newline',
        operationId: 'job-doc-mixed-newline',
      }),
    ).rejects.toThrow('markdown_document_invalid_output');
  });

  it('保留普通正文中不代表 Markdown 分块的 \\n 字面量', async () => {
    const generateStructured = vi.fn(async () => ({
      output: markdownDocumentContentSchema.parse({
        contentVersion: 1,
        markdown: '正则表达式 `\\n` 匹配换行符。',
        generatedByModel: true,
      }),
      metadata: {} as never,
    }));

    const result = await generateMarkdownDocumentContent({
      title: '正则说明',
      messages,
      gateway: { generateStructured } as StructuredModelGateway,
      traceId: 'trace-doc-literal-newline',
      operationId: 'job-doc-literal-newline',
    });

    expect(result.content.markdown).toContain('`\\n`');
  });

  it('有网关 revision 时透传当前文档真实换行（不再 JSON 字符串化 base content）', async () => {
    const generateStructured = vi.fn(async () => ({
      output: markdownDocumentContentSchema.parse({
        contentVersion: 1,
        markdown: '# 二次函数\n\n- revision',
        generatedByModel: true,
      }),
      metadata: {} as never,
    }));
    const gateway = { generateStructured } as StructuredModelGateway;

    await generateMarkdownDocumentContent({
      title: '二次函数',
      messages,
      gateway,
      traceId: 'trace-doc-revision-model-3',
      operationId: 'job-doc-revision-model-3',
      revision: {
        instruction: '增强结论',
        baseContent: {
          contentVersion: 1,
          markdown: '# 二次函数\n\n- 原始',
          generatedByModel: true,
        },
      },
    });

    expect(generateStructured.mock.calls).toHaveLength(1);
    const request = (
      generateStructured.mock.calls[0] as unknown as [
        StructuredModelRequest<unknown>,
      ]
    )[0];
    expect(request.messages.at(-1)?.content).toContain('# 二次函数\n\n- 原始');
  });
});
