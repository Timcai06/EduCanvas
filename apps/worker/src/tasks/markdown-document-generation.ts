import type { StructuredModelGateway } from '@educanvas/agent-core';
import {
  MARKDOWN_DOCUMENT_CONTENT_VERSION,
  MARKDOWN_DOCUMENT_MAX_CHARS,
  markdownDocumentContentSchema,
  type MarkdownDocumentContent,
} from '@educanvas/canvas-protocol';
import type { OutlineSourceMessage } from './mind-map-outline.js';
import {
  RULE_GENERATOR,
  MODEL_GENERATOR,
  RULE_REVISION_GENERATOR,
  MODEL_REVISION_GENERATOR,
  clip,
  buildTranscript,
  type ArtifactRevisionContext,
  type MarkdownLongformCheckpoint,
  type LongformUsage,
} from './markdown-generation-policy.js';
import { generateMarkdownLongform } from './markdown-longform-generation.js';
import { generateMarkdownRevision } from './markdown-revision-generation.js';

export {
  MARKDOWN_DOCUMENT_PROMPT_VERSION,
  MARKDOWN_DOCUMENT_REVISION_PROMPT_VERSION,
  RULE_GENERATOR,
  MODEL_GENERATOR,
  RULE_REVISION_GENERATOR,
  MODEL_REVISION_GENERATOR,
  MARKDOWN_LONGFORM_MAX_CALLS,
  MARKDOWN_LONGFORM_OUTPUT_TOKEN_BUDGET,
  MARKDOWN_LONGFORM_CHECKPOINT_VERSION,
  MarkdownDocumentGenerationFailure,
} from './markdown-generation-policy.js';
export type {
  ArtifactRevisionContext,
  MarkdownLongformCheckpoint,
} from './markdown-generation-policy.js';

const toRevisionMarkdown = (
  baseMarkdown: string,
  instruction: string,
): string =>
  [
    '# 修改版本文档',
    '',
    '## 既有内容',
    baseMarkdown,
    '',
    '## 本轮修改说明',
    clip(instruction, 4_000),
  ].join('\n');

const toInitialMarkdown = (
  title: string,
  messages: readonly OutlineSourceMessage[],
) =>
  [
    `# ${title}`,
    '',
    '## 对话摘要',
    ...messages.map(
      (message, index) =>
        `${index % 2 === 0 ? '- 问' : '- 答'}：${clip(message.content, 800)}`,
    ),
    '',
    '## 结构化提纲',
    '- 主题：课程知识点梳理',
    '- 目标：形成可复核的课堂文档',
    '- 输出：完整 Markdown 报告（含标题、摘要、要点与结论）',
  ].join('\n');

/** 仅用于无模型兜底场景，确保在任何环境都能产生可校验完整版本。 */
function buildRuleMarkdownDocument(input: {
  title: string;
  messages: readonly OutlineSourceMessage[];
  revision?: ArtifactRevisionContext;
}): MarkdownDocumentContent {
  if (input.revision) {
    const base = markdownDocumentContentSchema.parse(
      input.revision.baseContent,
    );
    const markdown = toRevisionMarkdown(
      base.markdown,
      input.revision.instruction,
    );
    return {
      contentVersion: MARKDOWN_DOCUMENT_CONTENT_VERSION,
      markdown: clip(markdown, MARKDOWN_DOCUMENT_MAX_CHARS),
      generatedByModel: false,
    };
  }
  return {
    contentVersion: MARKDOWN_DOCUMENT_CONTENT_VERSION,
    markdown: clip(
      toInitialMarkdown(input.title, input.messages),
      MARKDOWN_DOCUMENT_MAX_CHARS,
    ),
    generatedByModel: false,
  };
}

/**
 * 生成课程文档报告。无模型时使用确定性规则 fallback，避免空环境下失效；
 * 有模型时强制通过 structured schema（纯 Markdown，不要求/不生成原始 HTML）。
 */
export async function generateMarkdownDocumentContent(input: {
  title: string;
  messages: readonly OutlineSourceMessage[];
  gateway: StructuredModelGateway | null;
  traceId: string;
  operationId: string;
  revision?: ArtifactRevisionContext;
  checkpoint?: Record<string, unknown>;
  saveCheckpoint?: (checkpoint: MarkdownLongformCheckpoint) => Promise<void>;
}): Promise<{
  content: MarkdownDocumentContent;
  generatedBy: string;
  usage?: LongformUsage;
}> {
  const gateway = input.gateway;
  if (!gateway) {
    return {
      content: buildRuleMarkdownDocument(input),
      generatedBy: input.revision ? RULE_REVISION_GENERATOR : RULE_GENERATOR,
    };
  }

  if (input.revision) {
    const content = await generateMarkdownRevision({
      title: input.title,
      messages: input.messages,
      gateway,
      traceId: input.traceId,
      operationId: input.operationId,
      revision: input.revision,
      checkpoint: input.checkpoint,
      saveCheckpoint: input.saveCheckpoint,
    });
    return {
      content: content.content,
      generatedBy: MODEL_REVISION_GENERATOR,
      usage: content.usage,
    };
  }

  const transcript = buildTranscript(input.messages);
  const longform = await generateMarkdownLongform({
    input,
    transcript,
  });

  return {
    content: longform.content,
    generatedBy: input.revision ? MODEL_REVISION_GENERATOR : MODEL_GENERATOR,
    usage: longform.usage,
  };
}
