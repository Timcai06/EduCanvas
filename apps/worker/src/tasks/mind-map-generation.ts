import type { StructuredModelGateway } from '@educanvas/agent-core';
import {
  mindMapContentSchema,
  type MindMapContent,
} from '@educanvas/canvas-protocol';
import {
  buildConversationOutline,
  type OutlineSourceMessage,
} from './mind-map-outline.js';

export const MIND_MAP_PROMPT_VERSION = 'artifact-mind-map-v1';

/** 溯源标识写入 artifact_versions.generated_by,区分规则大纲与模型生成。 */
export const RULE_GENERATOR = 'rule:outline-v1';
export const MODEL_GENERATOR = 'model:artifact.generate:v1';

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
}): Promise<{ content: MindMapContent; generatedBy: string }> {
  if (!input.gateway) {
    return {
      content: buildConversationOutline(input.title, input.messages),
      generatedBy: RULE_GENERATOR,
    };
  }

  const result = await input.gateway.generateStructured({
    taskAlias: 'artifact.generate',
    modelAlias: 'structured',
    schema: mindMapContentSchema,
    promptVersion: MIND_MAP_PROMPT_VERSION,
    traceId: input.traceId,
    operationId: input.operationId,
    messages: [
      {
        role: 'system',
        content: [
          '你是知识结构梳理助手。根据给定的对话记录,产出一份中文思维导图。',
          '要求:root.label 使用给定标题;一级分支概括对话中的主要话题(不是逐句照抄);',
          '每个分支的子节点提炼关键概念或结论;节点 label 简洁(≤40字);',
          'id 使用小写字母数字与连字符;contentVersion 固定为 1;',
          '总节点数≤60,深度≤4;不要输出对话中不存在的内容。',
        ].join('\n'),
      },
      {
        role: 'user',
        content: `标题:${input.title}\n\n对话记录:\n${buildTranscript(input.messages)}`,
      },
    ],
  });
  return { content: result.output, generatedBy: MODEL_GENERATOR };
}
