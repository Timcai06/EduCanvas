import type { StructuredModelGateway } from '@educanvas/agent-core';
import {
  mindMapContentSchema,
  mindMapContentV2Schema,
  type MindMapContentV1,
  type MindMapContentV2,
} from '@educanvas/canvas-protocol';
import {
  buildConversationOutline,
  type OutlineSourceMessage,
} from './mind-map-outline.js';

export const MIND_MAP_PROMPT_VERSION = 'artifact-mind-map-v2';
export const MIND_MAP_REVISION_PROMPT_VERSION = 'artifact-mind-map-revision-v2';

/** 溯源标识写入 artifact_versions.generated_by,区分规则大纲与模型生成。 */
export const RULE_GENERATOR = 'rule:outline-v1';
export const MODEL_GENERATOR = 'model:artifact.generate:v1';
export const RULE_REVISION_GENERATOR = 'rule:mind-map-revision-v1';
export const MODEL_REVISION_GENERATOR =
  'model:artifact.generate:mind-map-revision-v1';

export interface ArtifactRevisionContext {
  instruction: string;
  baseContent: unknown;
}

const MAX_TRANSCRIPT_CHARS = 12_000;

const buildTranscript = (messages: readonly OutlineSourceMessage[]): string => {
  const lines = messages.map(
    (message) =>
      `${message.role === 'user' ? '学生' : 'AI'}: ${message.content}`,
  );
  let transcript = lines.join('\n');
  if (transcript.length > MAX_TRANSCRIPT_CHARS) {
    /* 保留最近内容:导图概括的是"这次对话",越新的轮次信息密度越高 */
    transcript = transcript.slice(-MAX_TRANSCRIPT_CHARS);
  }
  return transcript;
};

const toV2FromV1 = (content: MindMapContentV1): MindMapContentV2 => {
  const nodes: Array<{ id: string; label: string }> = [];
  const edges: Array<{ from: string; to: string }> = [];

  const walk = (
    node: MindMapContentV1['root'],
    parentId?: string,
    depth = 1,
  ) => {
    nodes.push({ id: node.id, label: node.label });
    if (parentId) {
      edges.push({ from: parentId, to: node.id });
    }
    for (const child of node.children ?? []) {
      walk(child, node.id, depth + 1);
    }
  };
  walk(content.root);

  return {
    contentVersion: 2,
    rootNodeId: content.root.id,
    nodes,
    edges,
  };
};

const appendRevisionNodeV2 = (
  content: MindMapContentV2,
  label: string,
): MindMapContentV2 => {
  const nodeIds = new Set(content.nodes.map((node) => node.id));
  let revisionIndex = 1;
  let revisionNodeId = `revision-${revisionIndex}`;
  while (nodeIds.has(revisionNodeId)) {
    revisionIndex += 1;
    revisionNodeId = `revision-${revisionIndex}`;
  }

  return {
    contentVersion: 2,
    rootNodeId: content.rootNodeId,
    nodes: [...content.nodes, { id: revisionNodeId, label }],
    edges: [
      ...content.edges,
      {
        from: content.rootNodeId,
        to: revisionNodeId,
        semanticRole: 'hierarchy',
      },
    ],
  };
};

/**
 * 思维导图内容生成策略:
 * - 模型网关**未配置**:确定性规则大纲(开发/E2E 的诚实默认,不伪装 AI);
 * - 网关**已配置**:模型经 `artifact.generate` 结构化生成,输出已过公开 Schema;
 *   配置存在但调用失败时向上抛出——已配置环境静默回退规则大纲等于伪装,
 *   必须以失败码呈现给用户。
 */
export async function generateMindMapContent(input: {
  title: string;
  messages: readonly OutlineSourceMessage[];
  gateway: StructuredModelGateway | null;
  traceId: string;
  operationId: string;
  revision?: ArtifactRevisionContext;
}): Promise<{ content: MindMapContentV2; generatedBy: string }> {
  if (!input.gateway) {
    if (input.revision) {
      const base = mindMapContentSchema.parse(input.revision.baseContent);
      const baseV2 =
        base.contentVersion === 2
          ? mindMapContentV2Schema.parse(base)
          : toV2FromV1(base as MindMapContentV1);
      return {
        content: appendRevisionNodeV2(
          baseV2,
          `修改：${input.revision.instruction.slice(0, 110)}`,
        ),
        generatedBy: RULE_REVISION_GENERATOR,
      };
    }

    const outline = buildConversationOutline(input.title, input.messages);
    return {
      content: toV2FromV1(outline),
      generatedBy: RULE_GENERATOR,
    };
  }

  const result = await input.gateway.generateStructured({
    taskAlias: 'artifact.generate',
    modelAlias: 'structured',
    schema: mindMapContentV2Schema,
    promptVersion: input.revision
      ? MIND_MAP_REVISION_PROMPT_VERSION
      : MIND_MAP_PROMPT_VERSION,
    traceId: input.traceId,
    operationId: input.operationId,
    messages: [
      {
        role: 'system',
        content: [
          input.revision
            ? '你是知识结构梳理助手。请在当前思维导图基础上按用户要求修改，并返回完整的新版本。'
            : '你是知识结构梳理助手。根据给定的对话记录,产出一份中文思维导图。',
          '要求:root.label 使用给定标题;一级分支概括对话中的主要话题(不是逐句照抄);',
          '每个分支的子节点提炼关键概念或结论;节点 label 简洁(≤40字);',
          'id 使用小写字母数字与连字符;contentVersion 固定为 2;',
          '总节点数≤60,深度≤4;不要输出对话和修改要求中不存在的内容。',
          input.revision
            ? '保留未被要求改变的结构；不要只返回差异或解释。'
            : '',
        ].join('\n'),
      },
      {
        role: 'user',
        content: input.revision
          ? `标题:${input.title}\n\n当前版本:\n${JSON.stringify(input.revision.baseContent)}\n\n修改要求:\n${input.revision.instruction}\n\nNotebook对话记录:\n${buildTranscript(input.messages)}`
          : `标题:${input.title}\n\n对话记录:\n${buildTranscript(input.messages)}`,
      },
    ],
  });

  return {
    content: result.output,
    generatedBy: input.revision ? MODEL_REVISION_GENERATOR : MODEL_GENERATOR,
  };
}
