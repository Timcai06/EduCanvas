import type { StructuredModelGateway } from '@educanvas/agent-core';
import {
  MARKDOWN_DOCUMENT_CONTENT_VERSION,
  MARKDOWN_DOCUMENT_KIND,
  MARKDOWN_DOCUMENT_MAX_CHARS,
  markdownDocumentContentSchema,
  type MarkdownDocumentContent,
} from '@educanvas/canvas-protocol';
import type { OutlineSourceMessage } from './mind-map-outline.js';

export const MARKDOWN_DOCUMENT_PROMPT_VERSION = 'artifact-markdown-document-v2';
export const MARKDOWN_DOCUMENT_REVISION_PROMPT_VERSION =
  'artifact-markdown-document-revision-v2';
export const RULE_GENERATOR = 'rule:markdown-document-v1';
export const MODEL_GENERATOR = 'model:artifact.generate:markdown-document-v1';
export const RULE_REVISION_GENERATOR = 'rule:markdown-document-revision-v1';
export const MODEL_REVISION_GENERATOR =
  'model:artifact.generate:markdown-document-revision-v1';

export interface ArtifactRevisionContext {
  instruction: string;
  baseContent: unknown;
}

const MAX_TRANSCRIPT_CHARS = 12_000;

const clip = (value: string, max: number): string =>
  value.length <= max ? value : `${value.slice(0, max - 1)}…`;

const stripCodeBlocks = (markdown: string): string => {
  return markdown.replace(/```[\s\S]*?```/g, '');
};

const stripInlineCode = (markdown: string): string =>
  markdown.replace(/`[^`]*`/g, '');

const hasCollapsedMarkdownBlocks = (markdown: string): boolean => {
  const sanitized = stripInlineCode(stripCodeBlocks(markdown));
  return /\\n(?:\\n)*(?:#{1,6}\s|[-*+]\s|>\s|\d+\.\s)/.test(sanitized);
};

const buildTranscript = (messages: readonly OutlineSourceMessage[]): string => {
  const lines = messages.map(
    (message) =>
      `${message.role === 'user' ? '学生' : 'AI'}: ${message.content}`,
  );
  let transcript = lines.join('\n');
  if (transcript.length > MAX_TRANSCRIPT_CHARS) {
    transcript = transcript.slice(-MAX_TRANSCRIPT_CHARS);
  }
  return transcript;
};

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
}): Promise<{ content: MarkdownDocumentContent; generatedBy: string }> {
  if (!input.gateway) {
    return {
      content: buildRuleMarkdownDocument(input),
      generatedBy: input.revision ? RULE_REVISION_GENERATOR : RULE_GENERATOR,
    };
  }

  let transcript = buildTranscript(input.messages);
  const revisionBase = input.revision
    ? markdownDocumentContentSchema.parse(input.revision.baseContent)
    : null;

  const result = await input.gateway.generateStructured({
    taskAlias: 'artifact.generate',
    modelAlias: 'structured',
    schema: markdownDocumentContentSchema,
    promptVersion: input.revision
      ? MARKDOWN_DOCUMENT_REVISION_PROMPT_VERSION
      : MARKDOWN_DOCUMENT_PROMPT_VERSION,
    traceId: input.traceId,
    operationId: input.operationId,
    messages: [
      {
        role: 'system',
        content: [
          input.revision
            ? '你是课程文档撰写助手。请在当前 Markdown 文档基础上按用户要求修改，并返回完整的新版本。'
            : `你是课程文档与技术报告撰写助手。请基于对话记录生成一份结构清晰、可复核的 Markdown 报告（kind=${MARKDOWN_DOCUMENT_KIND}）。`,
          '要求只输出 Markdown 文本，不包含 Raw HTML 标签。',
          '使用标题（#/##/###）、列表和要点组织内容；',
          '需要突出提示时可使用 > [!note] 标题；类型只能从 note、info、tip、success、question、warning、danger、example 中选择，只有确有必要时才使用；',
          '保留关键信息链路，不得编造未出现的事实；',
          `contentVersion 固定为 ${MARKDOWN_DOCUMENT_CONTENT_VERSION}，总字符上限 ${MARKDOWN_DOCUMENT_MAX_CHARS}。`,
          input.revision
            ? '返回完整新版本，不要只给差异；保留未被修改的章节逻辑。'
            : '',
        ].join('\n'),
      },
      {
        role: 'user',
        content: input.revision
          ? `标题：${input.title}\n\n当前文档：\n${revisionBase!.markdown}\n\n修改要求：\n${input.revision.instruction}\n\n对话记录：\n${transcript}`
          : `标题：${input.title}\n\n对话记录：\n${transcript}`,
      },
    ],
  });

  if (hasCollapsedMarkdownBlocks(result.output.markdown)) {
    throw new Error('markdown_document_invalid_output');
  }

  return {
    content: { ...result.output, generatedByModel: true },
    generatedBy: input.revision ? MODEL_REVISION_GENERATOR : MODEL_GENERATOR,
  };
}
