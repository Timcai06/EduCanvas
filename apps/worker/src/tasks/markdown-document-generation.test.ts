import {
  ModelGatewayInvocationError,
  type StructuredModelGateway,
  type StructuredModelRequest,
} from '@educanvas/agent-core';
import { markdownDocumentContentSchema } from '@educanvas/canvas-protocol';
import { describe, expect, it, vi } from 'vitest';
import {
  MARKDOWN_DOCUMENT_PROMPT_VERSION,
  MARKDOWN_DOCUMENT_REVISION_PROMPT_VERSION,
  MODEL_GENERATOR,
  MODEL_REVISION_GENERATOR,
  RULE_GENERATOR,
  RULE_REVISION_GENERATOR,
  generateMarkdownDocumentContent,
  MARKDOWN_LONGFORM_MAX_CALLS,
  MARKDOWN_LONGFORM_OUTPUT_TOKEN_BUDGET,
} from './markdown-document-generation';

const messages = [
  { role: 'user' as const, content: '二次函数顶点式的展开形式是什么？' },
  { role: 'assistant' as const, content: 'y=a(x-h)^2+k。' },
];

function fixtureGateway(markdown = '- 内容') {
  const generateStructured = vi.fn(
    async (request: StructuredModelRequest<unknown>) => ({
      output: request.operationId.endsWith(':plan')
        ? {
            sourceSummary: '来源摘要',
            sections: [{ title: '知识点', focus: '定义与示例' }],
          }
        : request.operationId.endsWith(':revision')
          ? {
              contentVersion: 1,
              markdown,
              generatedByModel: true,
            }
          : { markdown, continuationSummary: '已解释本段核心定义。' },
      metadata: { usage: { inputTokens: 50, outputTokens: 20 } } as never,
    }),
  );
  return {
    gateway: { generateStructured } as StructuredModelGateway,
    generateStructured,
  };
}

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
    const { gateway, generateStructured } = fixtureGateway(
      '- a=1\n- h=0\n- k=0',
    );

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
    expect(request.promptVersion).toBe(
      `${MARKDOWN_DOCUMENT_PROMPT_VERSION}:plan-v1`,
    );
    expect(request.maxOutputTokens).toBe(1_024);
    expect(generateStructured).toHaveBeenCalledTimes(2);
    expect(generateStructured.mock.calls[1]?.[0].maxOutputTokens).toBe(32_748);
    expect(result.usage).toEqual({
      calls: 2,
      inputTokens: 100,
      outputTokens: 40,
      totalTokens: 140,
    });
    expect(result.content.markdown).toContain('a=1');
  });

  it('有网关 revision 时返回完整版本并透传修改指令', async () => {
    const { gateway, generateStructured } = fixtureGateway('## 修订版');

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
    expect(request.operationId).toBe('job-doc-revision-model:revision');
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
    const { gateway } = fixtureGateway('- revision');

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
    const { gateway } = fixtureGateway('正文\\n\\n## 未解码小节');

    await expect(
      generateMarkdownDocumentContent({
        title: '二次函数',
        messages,
        gateway,
        traceId: 'trace-doc-invalid-model',
        operationId: 'job-doc-invalid-model',
      }),
    ).rejects.toThrow('invalid_output');
  });

  it('即使同时有真实换行也拒绝其余坍塌的 Markdown 分块', async () => {
    const { gateway } = fixtureGateway('正文\n## 第二段\\n\\n### 坍塌');

    await expect(
      generateMarkdownDocumentContent({
        title: '混合换行',
        messages,
        gateway,
        traceId: 'trace-doc-mixed-newline',
        operationId: 'job-doc-mixed-newline',
      }),
    ).rejects.toThrow('invalid_output');
  });

  it('保留普通正文中不代表 Markdown 分块的 \\n 字面量', async () => {
    const { gateway } = fixtureGateway('正则表达式 `\\n` 匹配换行符。');

    const result = await generateMarkdownDocumentContent({
      title: '正则说明',
      messages,
      gateway,
      traceId: 'trace-doc-literal-newline',
      operationId: 'job-doc-literal-newline',
    });

    expect(result.content.markdown).toContain('`\\n`');
  });

  it('有网关 revision 时透传当前文档真实换行（不再 JSON 字符串化 base content）', async () => {
    const { gateway, generateStructured } = fixtureGateway('- revision');

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
    expect(request.messages.at(-1)?.content).toContain('# 二次函数\n\n- 原始');
  });

  it('按提纲顺序最多四次调用并用前段衔接摘要提供上下文', async () => {
    const generateStructured = vi
      .fn()
      .mockResolvedValueOnce({
        output: {
          sourceSummary: '总来源摘要',
          sections: [
            { title: '第一章', focus: '第一部分' },
            { title: '第二章', focus: '第二部分' },
            { title: '第三章', focus: '第三部分' },
          ],
        },
        metadata: { usage: { inputTokens: 40_000, outputTokens: 1 } },
      })
      .mockResolvedValue({
        output: {
          markdown: '- 分段内容',
          continuationSummary: '已解释前段定义',
        },
        metadata: { usage: { inputTokens: 2, outputTokens: 3 } },
      });
    const result = await generateMarkdownDocumentContent({
      title: '长文',
      messages,
      gateway: { generateStructured } as unknown as StructuredModelGateway,
      traceId: 'trace-long',
      operationId: 'job-long',
    });
    expect(generateStructured).toHaveBeenCalledTimes(
      MARKDOWN_LONGFORM_MAX_CALLS,
    );
    expect(
      generateStructured.mock.calls.map(([request]) => request.operationId),
    ).toEqual([
      'job-long:longform:plan',
      'job-long:longform:section:1',
      'job-long:longform:section:2',
      'job-long:longform:section:3',
    ]);
    expect(
      generateStructured.mock.calls[2]?.[0].messages[1]?.content,
    ).toContain('前文衔接摘要：已解释前段定义');
    expect(result.content.markdown.indexOf('## 第一章')).toBeLessThan(
      result.content.markdown.indexOf('## 第二章'),
    );
    expect(result.content.markdown.indexOf('## 第二章')).toBeLessThan(
      result.content.markdown.indexOf('## 第三章'),
    );
    expect(result.usage?.outputTokens).toBeLessThanOrEqual(
      MARKDOWN_LONGFORM_OUTPUT_TOKEN_BUDGET,
    );
    expect(result.usage?.totalTokens).toBeGreaterThan(
      MARKDOWN_LONGFORM_OUTPUT_TOKEN_BUDGET,
    );
  });

  it('任何分段失败时不返回可提交的半成品', async () => {
    const generateStructured = vi
      .fn()
      .mockResolvedValueOnce({
        output: {
          sourceSummary: '来源摘要',
          sections: [
            { title: '第一章', focus: '一' },
            { title: '第二章', focus: '二' },
          ],
        },
        metadata: { usage: { inputTokens: 1, outputTokens: 1 } },
      })
      .mockResolvedValueOnce({
        output: { markdown: '- 第一段', continuationSummary: '第一段完成' },
        metadata: { usage: { inputTokens: 2, outputTokens: 3 } },
      })
      .mockRejectedValueOnce(new Error('section failed'));
    await expect(
      generateMarkdownDocumentContent({
        title: '长文',
        messages,
        gateway: { generateStructured } as unknown as StructuredModelGateway,
        traceId: 'trace-fail',
        operationId: 'job-fail',
      }),
    ).rejects.toThrow('section failed');
    expect(generateStructured).toHaveBeenCalledTimes(3);
  });

  it('重投复用checkpoint中的已完成段，只续跑下一段且调用ID稳定', async () => {
    let checkpoint: Record<string, unknown> | undefined;
    let interrupted = false;
    const saveCheckpoint = vi.fn(async (next: Record<string, unknown>) => {
      checkpoint = structuredClone(next);
      if (
        !interrupted &&
        Array.isArray(next.completedSections) &&
        next.completedSections.length === 1
      ) {
        interrupted = true;
        throw new Error('simulated interruption after durable checkpoint');
      }
    });
    const first = vi
      .fn()
      .mockResolvedValueOnce({
        output: {
          sourceSummary: '来源摘要',
          sections: [
            { title: '第一章', focus: '一' },
            { title: '第二章', focus: '二' },
            { title: '第三章', focus: '三' },
          ],
        },
        metadata: { usage: { inputTokens: 10, outputTokens: 2 } },
      })
      .mockResolvedValueOnce({
        output: { markdown: '- 第一段', continuationSummary: '一段结论' },
        metadata: { usage: { inputTokens: 5, outputTokens: 20 } },
      })
      .mockImplementation(async () => {
        throw new Error('unexpected extra provider call');
      });
    const args = {
      title: '重投文档',
      messages,
      traceId: 'trace-resume',
      operationId: 'job-resume',
    };
    await expect(
      generateMarkdownDocumentContent({
        ...args,
        gateway: {
          generateStructured: first,
        } as unknown as StructuredModelGateway,
        saveCheckpoint,
      }),
    ).rejects.toThrow('simulated interruption after durable checkpoint');
    expect(checkpoint).toMatchObject({
      stage: 'markdown-longform-v2',
      pendingCall: null,
      callsStarted: 2,
      completedSections: [
        { index: 0, markdown: '- 第一段', continuationSummary: '一段结论' },
      ],
    });

    const retry = vi.fn(async (_request: StructuredModelRequest<unknown>) => ({
      output: { markdown: '- 续写内容', continuationSummary: '后续已完成' },
      metadata: { usage: { inputTokens: 4, outputTokens: 8 } },
    }));
    const result = await generateMarkdownDocumentContent({
      ...args,
      gateway: {
        generateStructured: retry,
      } as unknown as StructuredModelGateway,
      checkpoint,
      saveCheckpoint,
    });
    expect(retry).toHaveBeenCalledTimes(2);
    expect(retry.mock.calls.map((call) => call[0].operationId)).toEqual([
      'job-resume:longform:section:2',
      'job-resume:longform:section:3',
    ]);
    expect(result.content.markdown).toContain('- 第一段');
    expect(result.content.markdown).toContain('- 续写内容');
    expect(result.usage).toEqual({
      calls: 4,
      inputTokens: 23,
      outputTokens: 38,
      totalTokens: 61,
    });
  });

  it('结果不确定时保留完整输出预留并拒绝跨 attempt 再次调用', async () => {
    let checkpoint: Record<string, unknown> | undefined;
    const saveCheckpoint = vi.fn(async (next: Record<string, unknown>) => {
      checkpoint = structuredClone(next);
    });
    const failedCall = vi.fn(async () => {
      expect(checkpoint).toMatchObject({
        callsStarted: 1,
        reservedOutputTokens: 1_024,
        pendingCall: {
          operationId: 'job-unknown:longform:plan',
          maxOutputTokens: 1_024,
        },
      });
      throw new Error('provider timeout');
    });
    const args = {
      title: '不确定结果',
      messages,
      traceId: 'trace-unknown',
      operationId: 'job-unknown',
      saveCheckpoint,
    };
    await expect(
      generateMarkdownDocumentContent({
        ...args,
        gateway: {
          generateStructured: failedCall,
        } as unknown as StructuredModelGateway,
      }),
    ).rejects.toThrow('provider timeout');
    expect(checkpoint).toMatchObject({
      callsStarted: 1,
      reservedOutputTokens: 1_024,
      pendingCall: {
        operationId: 'job-unknown:longform:plan',
        maxOutputTokens: 1_024,
      },
    });

    const retryCall = vi.fn();
    await expect(
      generateMarkdownDocumentContent({
        ...args,
        checkpoint,
        gateway: {
          generateStructured: retryCall,
        } as unknown as StructuredModelGateway,
      }),
    ).rejects.toMatchObject({ code: 'model_outcome_unknown' });
    expect(retryCall).not.toHaveBeenCalled();
  });

  it('明确429拒绝仍消耗总调用上限，四次后不再发送请求', async () => {
    let checkpoint: Record<string, unknown> | undefined;
    const gateway = {
      generateStructured: vi.fn(async () => {
        throw new ModelGatewayInvocationError(
          { code: 'rate_limit', retryable: true },
          { executionOutcome: 'not_executed' },
        );
      }),
    } as StructuredModelGateway;
    const args = {
      title: '持续拒绝',
      messages,
      gateway,
      traceId: 'trace-rate-limit',
      operationId: 'job-rate-limit',
      saveCheckpoint: async (next: Record<string, unknown>) => {
        checkpoint = structuredClone(next);
      },
    };
    for (
      let attempt = 1;
      attempt <= MARKDOWN_LONGFORM_MAX_CALLS;
      attempt += 1
    ) {
      await expect(
        generateMarkdownDocumentContent({ ...args, checkpoint }),
      ).rejects.toMatchObject({ normalized: { code: 'rate_limit' } });
      expect(checkpoint).toMatchObject({
        callsStarted: attempt,
        reservedOutputTokens: 0,
        pendingCall: null,
      });
    }
    await expect(
      generateMarkdownDocumentContent({ ...args, checkpoint }),
    ).rejects.toMatchObject({ code: 'model_output_limit' });
    expect(gateway.generateStructured).toHaveBeenCalledTimes(
      MARKDOWN_LONGFORM_MAX_CALLS,
    );
  });

  it('revision被429拒绝后保留完整32768输出能力并恢复', async () => {
    let checkpoint: Record<string, unknown> | undefined;
    const { gateway, generateStructured } = fixtureGateway('# 完整修订');
    generateStructured.mockRejectedValueOnce(
      new ModelGatewayInvocationError(
        { code: 'rate_limit', retryable: true },
        { executionOutcome: 'not_executed' },
      ),
    );
    const args = {
      title: '修订文档',
      messages,
      gateway,
      traceId: 'trace-revision-429',
      operationId: 'job-revision-429',
      revision: {
        instruction: '补充结论',
        baseContent: {
          contentVersion: 1,
          markdown: '# 旧稿',
          generatedByModel: true,
        },
      },
      saveCheckpoint: async (next: Record<string, unknown>) => {
        checkpoint = structuredClone(next);
      },
    };
    await expect(generateMarkdownDocumentContent(args)).rejects.toMatchObject({
      normalized: { code: 'rate_limit' },
    });
    expect(checkpoint).toMatchObject({
      callsStarted: 1,
      reservedOutputTokens: 0,
      pendingCall: null,
    });
    const result = await generateMarkdownDocumentContent({
      ...args,
      checkpoint,
    });
    expect(result.content.markdown).toBe('# 完整修订');
    expect(
      generateStructured.mock.calls.map(([request]) => request.maxOutputTokens),
    ).toEqual([32_768, 32_768]);
    expect(
      generateStructured.mock.calls.map(([request]) => request.operationId),
    ).toEqual(['job-revision-429:revision', 'job-revision-429:revision']);
  });
});
