import type {
  StructuredModelGateway,
  StructuredModelRequest,
} from '@educanvas/agent-core';
import { mindMapContentSchema } from '@educanvas/canvas-protocol';
import { describe, expect, it, vi } from 'vitest';
import {
  MODEL_GENERATOR,
  MODEL_REVISION_GENERATOR,
  RULE_GENERATOR,
  RULE_REVISION_GENERATOR,
  generateMindMapContent,
} from './mind-map-generation';

const messages = [
  { role: 'user' as const, content: '什么是神经网络?' },
  { role: 'assistant' as const, content: '神经网络是…\n## 神经元\n内容' },
];

describe('generateMindMapContent', () => {
  it('网关未配置时走确定性规则大纲并标记溯源', async () => {
    const result = await generateMindMapContent({
      title: '对话思维导图',
      messages,
      gateway: null,
      traceId: 'trace-1',
      operationId: 'job-1',
    });
    expect(result.generatedBy).toBe(RULE_GENERATOR);
    expect(result.content.root.label).toBe('对话思维导图');
    expect(mindMapContentSchema.safeParse(result.content).success).toBe(true);
  });

  it('网关已配置时经 artifact.generate 结构化生成并标记模型溯源', async () => {
    const generateStructured = vi.fn(
      async (request: StructuredModelRequest<unknown>) => ({
        output: request.schema.parse({
          contentVersion: 1,
          root: {
            id: 'root',
            label: '对话思维导图',
            children: [{ id: 'topic-1', label: '神经网络基础' }],
          },
        }),
        metadata: {} as never,
      }),
    );
    const gateway = { generateStructured } as StructuredModelGateway;

    const result = await generateMindMapContent({
      title: '对话思维导图',
      messages,
      gateway,
      traceId: 'trace-1',
      operationId: 'job-1',
    });

    expect(result.generatedBy).toBe(MODEL_GENERATOR);
    expect(result.content.root.children?.[0]?.label).toBe('神经网络基础');
    const request = generateStructured.mock
      .calls[0]![0] as StructuredModelRequest<unknown>;
    expect(request.taskAlias).toBe('artifact.generate');
    expect(request.modelAlias).toBe('structured');
    expect(request.messages.at(-1)?.content).toContain('什么是神经网络?');
  });

  it('网关已配置但调用失败时向上抛出,不静默回退规则大纲', async () => {
    const gateway = {
      generateStructured: vi.fn(async () => {
        throw new Error('provider down');
      }),
    } as unknown as StructuredModelGateway;

    await expect(
      generateMindMapContent({
        title: '标题',
        messages,
        gateway,
        traceId: 'trace-1',
        operationId: 'job-1',
      }),
    ).rejects.toThrow('provider down');
  });

  it('修改轮次把基线内容和修改要求交给模型并标记新版本溯源', async () => {
    const baseContent = mindMapContentSchema.parse({
      contentVersion: 1,
      root: { id: 'root', label: '原导图' },
    });
    const generateStructured = vi.fn(
      async (request: StructuredModelRequest<unknown>) => ({
        output: request.schema.parse({
          contentVersion: 1,
          root: {
            id: 'root',
            label: '原导图',
            children: [{ id: 'cnn', label: '卷积层' }],
          },
        }),
        metadata: {} as never,
      }),
    );
    const result = await generateMindMapContent({
      title: '原导图',
      messages,
      gateway: { generateStructured } as StructuredModelGateway,
      traceId: 'trace-revision',
      operationId: 'job-revision',
      revision: {
        instruction: '增加卷积层分支',
        baseContent,
      },
    });

    expect(result.generatedBy).toBe(MODEL_REVISION_GENERATOR);
    const request = generateStructured.mock
      .calls[0]![0] as StructuredModelRequest<unknown>;
    expect(request.messages.at(-1)?.content).toContain('增加卷积层分支');
    expect(request.messages.at(-1)?.content).toContain('当前版本');
  });

  it('无模型的测试环境也以明确规则溯源追加修改版本', async () => {
    const result = await generateMindMapContent({
      title: '原导图',
      messages,
      gateway: null,
      traceId: 'trace-rule-revision',
      operationId: 'job-rule-revision',
      revision: {
        instruction: '增加卷积层分支',
        baseContent: {
          contentVersion: 1,
          root: { id: 'root', label: '原导图' },
        },
      },
    });
    expect(result.generatedBy).toBe(RULE_REVISION_GENERATOR);
    expect(result.content.root.children?.[0]?.label).toBe(
      '修改：增加卷积层分支',
    );
  });
});
