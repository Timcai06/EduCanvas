import type {
  StructuredModelGateway,
  StructuredModelRequest,
} from '@educanvas/agent-core';
import {
  MIND_MAP_CONTENT_VERSION_V1,
  MIND_MAP_CONTENT_VERSION_V2,
  mindMapContentSchema,
} from '@educanvas/canvas-protocol';
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
  it('网关未配置时走确定性规则大纲并标记溯源，且输出 v2', async () => {
    const result = await generateMindMapContent({
      title: '对话思维导图',
      messages,
      gateway: null,
      traceId: 'trace-1',
      operationId: 'job-1',
    });
    expect(result.generatedBy).toBe(RULE_GENERATOR);
    expect(result.content.contentVersion).toBe(MIND_MAP_CONTENT_VERSION_V2);
    expect(result.content.rootNodeId).toBe('root');
    expect(mindMapContentSchema.safeParse(result.content).success).toBe(true);
  });

  it('网关已配置时经 artifact.generate 结构化生成并标记模型溯源', async () => {
    const generateStructured = vi.fn(
      async (request: StructuredModelRequest<unknown>) => ({
        output: request.schema.parse({
          contentVersion: MIND_MAP_CONTENT_VERSION_V2,
          rootNodeId: 'root',
          nodes: [{ id: 'root', label: '对话思维导图' }],
          edges: [],
          groups: [],
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
    expect(result.content.nodes[0]?.id).toBe('root');
    const request = generateStructured.mock
      .calls[0]![0] as StructuredModelRequest<unknown>;
    expect(request.taskAlias).toBe('artifact.generate');
    expect(request.modelAlias).toBe('structured');
    expect(request.messages.at(-1)?.content).toContain('什么是神经网络?');
    expect(request.messages.at(0)?.content).toContain(
      'contentVersion 固定为 2',
    );
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

  it('修订输入可为 v1，输出仍是 v2 且模型标注修订溯源', async () => {
    const baseContent = mindMapContentSchema.parse({
      contentVersion: MIND_MAP_CONTENT_VERSION_V1,
      root: {
        id: 'root',
        label: '原导图',
        children: [{ id: 'a', label: '节点A' }],
      },
    });
    const generateStructured = vi.fn(
      async (request: StructuredModelRequest<unknown>) => ({
        output: request.schema.parse({
          contentVersion: MIND_MAP_CONTENT_VERSION_V2,
          rootNodeId: 'root',
          nodes: [
            { id: 'root', label: '原导图', semanticRole: 'root' },
            { id: 'a', label: '节点A', semanticRole: 'topic' },
            { id: 'cnn', label: '卷积层', semanticRole: 'topic' },
          ],
          edges: [
            { from: 'root', to: 'a', semanticRole: 'hierarchy' },
            { from: 'root', to: 'cnn', semanticRole: 'hierarchy' },
          ],
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
    expect(result.content.contentVersion).toBe(MIND_MAP_CONTENT_VERSION_V2);
    const request = generateStructured.mock
      .calls[0]![0] as StructuredModelRequest<unknown>;
    expect(request.messages.at(-1)?.content).toContain('增加卷积层分支');
    expect(request.messages.at(-1)?.content).toContain('当前版本');
  });

  it('无模型修订输入可接受 v1 历史内容并输出 v2', async () => {
    const result = await generateMindMapContent({
      title: '原导图',
      messages,
      gateway: null,
      traceId: 'trace-rule-revision',
      operationId: 'job-rule-revision',
      revision: {
        instruction: '增加卷积层分支',
        baseContent: {
          contentVersion: MIND_MAP_CONTENT_VERSION_V1,
          root: { id: 'root', label: '原导图' },
        },
      },
    });
    expect(result.generatedBy).toBe(RULE_REVISION_GENERATOR);
    expect(result.content.contentVersion).toBe(MIND_MAP_CONTENT_VERSION_V2);
    expect(result.content.nodes).toHaveLength(2);
    expect(result.content.edges).toHaveLength(1);
  });

  it('拒绝非法历史版本，不允许静默回退或迁移', async () => {
    await expect(
      generateMindMapContent({
        title: '原导图',
        messages,
        gateway: null,
        traceId: 'trace-rule-revision',
        operationId: 'job-rule-revision',
        revision: {
          instruction: '非法',
          baseContent: {
            contentVersion: 99,
            root: { id: 'root', label: '原导图' },
          },
        },
      }),
    ).rejects.toThrow();
  });
});
