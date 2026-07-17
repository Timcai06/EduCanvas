import type {
  StructuredModelGateway,
  StructuredModelRequest,
} from '@educanvas/agent-core';
import { mindMapContentSchema } from '@educanvas/canvas-protocol';
import { describe, expect, it, vi } from 'vitest';
import {
  MODEL_GENERATOR,
  RULE_GENERATOR,
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
});
