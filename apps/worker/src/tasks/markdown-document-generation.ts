import {
  ModelGatewayInvocationError,
  type StructuredModelGateway,
  type StructuredModelRequest,
  type StructuredModelResult,
} from '@educanvas/agent-core';
import { createHash } from 'node:crypto';
import { z } from 'zod';
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

/** Longform is deliberately bounded: one plan and at most three ordered sections. */
export const MARKDOWN_LONGFORM_MAX_CALLS = 4;
/** Hard cap applies to provider-reported output tokens across the job's lifetime. */
export const MARKDOWN_LONGFORM_OUTPUT_TOKEN_BUDGET = 32_768;
export const MARKDOWN_LONGFORM_CHECKPOINT_VERSION = 'markdown-longform-v2';
const MARKDOWN_LONGFORM_MAX_PLAN_OUTPUT_TOKENS = 1_024;

export interface ArtifactRevisionContext {
  instruction: string;
  baseContent: unknown;
}

const MAX_TRANSCRIPT_CHARS = 12_000;

const longformSectionPlanSchema = z.object({
  title: z.string().min(1).max(120),
  focus: z.string().min(1).max(800),
});

const longformPlanSchema = z.object({
  sourceSummary: z.string().min(1).max(1_200),
  sections: z
    .array(longformSectionPlanSchema)
    .min(1)
    .max(MARKDOWN_LONGFORM_MAX_CALLS - 1),
});

const longformSectionSchema = z.object({
  markdown: z.string().min(1).max(MARKDOWN_DOCUMENT_MAX_CHARS),
  continuationSummary: z.string().min(1).max(1_200),
});

const checkpointSectionsSchema = z
  .array(longformSectionPlanSchema)
  .max(MARKDOWN_LONGFORM_MAX_CALLS - 1);

const longformCheckpointSchema = z
  .object({
    stage: z.literal(MARKDOWN_LONGFORM_CHECKPOINT_VERSION),
    inputFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    sourceSummary: z.string().max(1_200),
    sections: checkpointSectionsSchema,
    completedSections: z
      .array(
        z.object({
          index: z
            .number()
            .int()
            .min(0)
            .max(MARKDOWN_LONGFORM_MAX_CALLS - 2),
          markdown: longformSectionSchema.shape.markdown,
          continuationSummary: longformSectionSchema.shape.continuationSummary,
        }),
      )
      .max(MARKDOWN_LONGFORM_MAX_CALLS - 1),
    usage: z.object({
      calls: z.number().int().nonnegative().max(MARKDOWN_LONGFORM_MAX_CALLS),
      inputTokens: z.number().int().nonnegative(),
      outputTokens: z
        .number()
        .int()
        .nonnegative()
        .max(MARKDOWN_LONGFORM_OUTPUT_TOKEN_BUDGET),
      totalTokens: z.number().int().nonnegative(),
    }),
    callsStarted: z
      .number()
      .int()
      .nonnegative()
      .max(MARKDOWN_LONGFORM_MAX_CALLS),
    reservedOutputTokens: z
      .number()
      .int()
      .nonnegative()
      .max(MARKDOWN_LONGFORM_OUTPUT_TOKEN_BUDGET),
    pendingCall: z
      .object({
        operationId: z.string().min(1).max(300),
        maxOutputTokens: z
          .number()
          .int()
          .positive()
          .max(MARKDOWN_LONGFORM_OUTPUT_TOKEN_BUDGET),
      })
      .nullable(),
    revisionMarkdown: z.string().max(MARKDOWN_DOCUMENT_MAX_CHARS).nullable(),
  })
  .strict();

export type MarkdownLongformCheckpoint = z.infer<
  typeof longformCheckpointSchema
>;

type LongformUsage = {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export class MarkdownDocumentGenerationFailure extends Error {
  constructor(
    readonly code:
      'model_output_limit' | 'model_outcome_unknown' | 'invalid_output',
  ) {
    super(code);
    this.name = 'MarkdownDocumentGenerationFailure';
  }
}

function mergeUsage(total: LongformUsage, usage: LongformUsage): LongformUsage {
  return {
    calls: total.calls + usage.calls,
    inputTokens: total.inputTokens + usage.inputTokens,
    outputTokens: total.outputTokens + usage.outputTokens,
    totalTokens: total.totalTokens + usage.totalTokens,
  };
}

async function invokeReservedModel<Output>(
  gateway: StructuredModelGateway,
  request: StructuredModelRequest<Output>,
  releaseRejectedReservation: () => Promise<void>,
): Promise<StructuredModelResult<Output>> {
  try {
    return await gateway.generateStructured(request);
  } catch (error) {
    if (
      error instanceof ModelGatewayInvocationError &&
      error.normalized.code === 'rate_limit' &&
      error.normalized.retryable &&
      error.executionOutcome === 'not_executed'
    ) {
      // 保留 callsStarted；拒绝也消耗有限调用次数，但不会消耗输出预算。
      await releaseRejectedReservation();
    }
    throw error;
  }
}

function buildSectionMessages(input: {
  title: string;
  index: number;
  total: number;
  sectionTitle: string;
  focus: string;
  sourceSummary: string;
  precedingSummary: string;
}) {
  return [
    {
      role: 'system' as const,
      content: [
        '你正在生成长文的一段，返回本段 Markdown 和供下一段衔接的简短摘要。',
        '只用资料支持的事实；不得重复前段，不得写文档总标题或总结性结尾。',
        '不得输出 Raw HTML。保留关键定义、步骤与因果关系；不要为了缩短而省略本段重点。',
        '使用 Markdown 标题、列表或代码块组织内容，代码围栏必须成对。',
      ].join('\n'),
    },
    {
      role: 'user' as const,
      content: [
        `文档标题：${input.title}`,
        `本段序号：${input.index}/${input.total}`,
        `本段标题：${input.sectionTitle}`,
        `本段范围：${input.focus}`,
        `来源摘要：${input.sourceSummary}`,
        `前文衔接摘要：${input.precedingSummary}`,
      ].join('\n\n'),
    },
  ];
}

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

async function generateMarkdownRevision(input: {
  title: string;
  messages: readonly OutlineSourceMessage[];
  gateway: StructuredModelGateway;
  traceId: string;
  operationId: string;
  revision: ArtifactRevisionContext;
  checkpoint?: Record<string, unknown>;
  saveCheckpoint?: (checkpoint: MarkdownLongformCheckpoint) => Promise<void>;
}): Promise<{ content: MarkdownDocumentContent; usage: LongformUsage }> {
  const base = markdownDocumentContentSchema.parse(input.revision.baseContent);
  const transcript = buildTranscript(input.messages);
  const messages = [
    {
      role: 'system' as const,
      content: [
        '你是课程文档撰写助手。请在当前 Markdown 文档基础上按用户要求修改，并返回完整的新版本。',
        '只输出 Markdown 文本，不包含 Raw HTML 标签。',
        '保留关键信息链路，不得编造未出现的事实。',
        `contentVersion 固定为 ${MARKDOWN_DOCUMENT_CONTENT_VERSION}，总字符上限 ${MARKDOWN_DOCUMENT_MAX_CHARS}。`,
        '返回完整新版本，不要只给差异；保留未被修改的章节逻辑。',
      ].join('\n'),
    },
    {
      role: 'user' as const,
      content: `标题：${input.title}\n\n当前文档：\n${base.markdown}\n\n修改要求：\n${clip(input.revision.instruction, 4_000)}\n\n对话记录：\n${transcript}`,
    },
  ];
  const inputFingerprint = createHash('sha256')
    .update(
      JSON.stringify([
        input.title,
        transcript,
        base.markdown,
        input.revision.instruction,
        MARKDOWN_DOCUMENT_REVISION_PROMPT_VERSION,
      ]),
    )
    .digest('hex');
  let checkpoint: MarkdownLongformCheckpoint | null = null;
  if (
    input.checkpoint?.stage === 'markdown-longform-v1' ||
    input.checkpoint?.stage === 'markdown-revision-v1'
  ) {
    throw new MarkdownDocumentGenerationFailure('model_outcome_unknown');
  }
  if (
    input.checkpoint &&
    Object.keys(input.checkpoint).length > 0 &&
    input.checkpoint.stage !== MARKDOWN_LONGFORM_CHECKPOINT_VERSION
  ) {
    throw new MarkdownDocumentGenerationFailure('invalid_output');
  }
  if (input.checkpoint?.stage === MARKDOWN_LONGFORM_CHECKPOINT_VERSION) {
    const parsed = longformCheckpointSchema.safeParse(input.checkpoint);
    if (!parsed.success || parsed.data.inputFingerprint !== inputFingerprint) {
      throw new MarkdownDocumentGenerationFailure('invalid_output');
    }
    checkpoint = parsed.data;
    if (checkpoint.pendingCall) {
      throw new MarkdownDocumentGenerationFailure('model_outcome_unknown');
    }
    if (checkpoint.revisionMarkdown !== null) {
      const cached = markdownDocumentContentSchema.parse({
        contentVersion: MARKDOWN_DOCUMENT_CONTENT_VERSION,
        markdown: checkpoint.revisionMarkdown,
        generatedByModel: true,
      });
      return { content: cached, usage: checkpoint.usage };
    }
  }
  const callsStarted = checkpoint?.callsStarted ?? 0;
  if (callsStarted >= MARKDOWN_LONGFORM_MAX_CALLS) {
    throw new MarkdownDocumentGenerationFailure('model_output_limit');
  }
  const outputReserve = MARKDOWN_LONGFORM_OUTPUT_TOKEN_BUDGET;
  if (
    checkpoint &&
    checkpoint.usage.outputTokens +
      checkpoint.reservedOutputTokens +
      outputReserve >
      MARKDOWN_LONGFORM_OUTPUT_TOKEN_BUDGET
  ) {
    throw new MarkdownDocumentGenerationFailure('model_output_limit');
  }
  const pendingOperationId = `${input.operationId}:revision`;
  const beforeCall = longformCheckpointSchema.parse({
    stage: MARKDOWN_LONGFORM_CHECKPOINT_VERSION,
    inputFingerprint,
    sourceSummary: '',
    sections: [],
    completedSections: [],
    usage: checkpoint?.usage ?? {
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    },
    callsStarted: callsStarted + 1,
    reservedOutputTokens:
      (checkpoint?.reservedOutputTokens ?? 0) + outputReserve,
    pendingCall: {
      operationId: pendingOperationId,
      maxOutputTokens: outputReserve,
    },
    revisionMarkdown: null,
  });
  await input.saveCheckpoint?.(beforeCall);
  const result = await invokeReservedModel(
    input.gateway,
    {
      taskAlias: 'artifact.generate',
      modelAlias: 'structured',
      schema: markdownDocumentContentSchema,
      promptVersion: MARKDOWN_DOCUMENT_REVISION_PROMPT_VERSION,
      traceId: input.traceId,
      operationId: pendingOperationId,
      maxOutputTokens: outputReserve,
      messages,
    },
    async () => {
      await input.saveCheckpoint?.({
        ...beforeCall,
        reservedOutputTokens: beforeCall.reservedOutputTokens - outputReserve,
        pendingCall: null,
      });
    },
  );
  const usage: LongformUsage = {
    calls: 1,
    inputTokens: result.metadata.usage.inputTokens,
    outputTokens: result.metadata.usage.outputTokens,
    totalTokens:
      result.metadata.usage.inputTokens + result.metadata.usage.outputTokens,
  };
  if (
    usage.outputTokens > outputReserve ||
    usage.outputTokens > MARKDOWN_LONGFORM_OUTPUT_TOKEN_BUDGET
  ) {
    throw new MarkdownDocumentGenerationFailure('model_output_limit');
  }
  if (hasCollapsedMarkdownBlocks(result.output.markdown)) {
    throw new MarkdownDocumentGenerationFailure('invalid_output');
  }
  const savedResult = longformCheckpointSchema.parse({
    ...beforeCall,
    usage,
    reservedOutputTokens: 0,
    pendingCall: null,
    revisionMarkdown: result.output.markdown,
  });
  await input.saveCheckpoint?.(savedResult);
  return {
    content: { ...result.output, generatedByModel: true },
    usage,
  };
}

async function generateMarkdownLongform(args: {
  input: {
    title: string;
    gateway: StructuredModelGateway | null;
    traceId: string;
    operationId: string;
    revision?: ArtifactRevisionContext;
    checkpoint?: Record<string, unknown>;
    saveCheckpoint?: (checkpoint: MarkdownLongformCheckpoint) => Promise<void>;
  };
  transcript: string;
  revisionBase?: string;
}): Promise<{ content: MarkdownDocumentContent; usage: LongformUsage }> {
  const { input, transcript, revisionBase } = args;
  const gateway = input.gateway;
  if (!gateway) throw new Error('markdown_document_gateway_missing');
  const revisionInstruction = input.revision
    ? clip(input.revision.instruction, 4_000)
    : undefined;
  const inputFingerprint = createHash('sha256')
    .update(
      JSON.stringify([
        input.title,
        transcript,
        revisionBase ?? null,
        revisionInstruction ?? null,
        input.revision
          ? MARKDOWN_DOCUMENT_REVISION_PROMPT_VERSION
          : MARKDOWN_DOCUMENT_PROMPT_VERSION,
      ]),
    )
    .digest('hex');
  let checkpoint: MarkdownLongformCheckpoint | null = null;
  if (
    input.checkpoint?.stage === 'markdown-longform-v1' ||
    input.checkpoint?.stage === 'markdown-revision-v1'
  ) {
    throw new MarkdownDocumentGenerationFailure('model_outcome_unknown');
  }
  if (
    input.checkpoint &&
    Object.keys(input.checkpoint).length > 0 &&
    input.checkpoint.stage !== MARKDOWN_LONGFORM_CHECKPOINT_VERSION
  ) {
    throw new MarkdownDocumentGenerationFailure('invalid_output');
  }
  if (input.checkpoint?.stage === MARKDOWN_LONGFORM_CHECKPOINT_VERSION) {
    const parsed = longformCheckpointSchema.safeParse(input.checkpoint);
    if (!parsed.success) {
      throw new MarkdownDocumentGenerationFailure('invalid_output');
    }
    if (parsed.data.inputFingerprint !== inputFingerprint) {
      throw new MarkdownDocumentGenerationFailure('invalid_output');
    }
    checkpoint = parsed.data;
    if (checkpoint.pendingCall) {
      throw new MarkdownDocumentGenerationFailure('model_outcome_unknown');
    }
    if (
      (checkpoint.sections.length === 0 &&
        (checkpoint.usage.calls !== 0 ||
          checkpoint.completedSections.length !== 0 ||
          checkpoint.sourceSummary !== '')) ||
      checkpoint.completedSections.some(
        (section, index) =>
          section.index !== index ||
          section.index >= checkpoint!.sections.length,
      )
    ) {
      throw new MarkdownDocumentGenerationFailure('invalid_output');
    }
  }

  const planMessages = [
    {
      role: 'system' as const,
      content: [
        `你为 kind=${MARKDOWN_DOCUMENT_KIND} 的 Markdown 文档制定最多三段、按阅读顺序排列的提纲。`,
        '只规划主题与边界，不写正文；段落之间不得重复。',
        'summary 只概括来源中可支持的事实，不得添加资料中没有的事实。',
      ].join('\n'),
    },
    {
      role: 'user' as const,
      content: [
        `标题：${input.title}`,
        revisionBase ? `当前文档：\n${revisionBase}` : '',
        revisionInstruction ? `修改要求：\n${revisionInstruction}` : '',
        `对话记录：\n${transcript}`,
      ]
        .filter(Boolean)
        .join('\n\n'),
    },
  ];
  if (checkpoint?.pendingCall) {
    throw new MarkdownDocumentGenerationFailure('model_outcome_unknown');
  }
  if (checkpoint && checkpoint.revisionMarkdown !== null) {
    throw new MarkdownDocumentGenerationFailure('invalid_output');
  }

  let usage: LongformUsage = checkpoint?.usage ?? {
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
  };
  let callsStarted = checkpoint?.callsStarted ?? 0;
  let reservedOutputTokens = checkpoint?.reservedOutputTokens ?? 0;
  let sourceSummary = checkpoint?.sourceSummary ?? '';
  let sectionPlan = checkpoint?.sections ?? [];
  const completedSections = [...(checkpoint?.completedSections ?? [])];

  const persistCheckpoint = async (
    pendingCall: MarkdownLongformCheckpoint['pendingCall'],
  ) => {
    const next = longformCheckpointSchema.parse({
      stage: MARKDOWN_LONGFORM_CHECKPOINT_VERSION,
      inputFingerprint,
      sourceSummary,
      sections: sectionPlan,
      completedSections,
      usage,
      callsStarted,
      reservedOutputTokens,
      pendingCall,
      revisionMarkdown: null,
    });
    await input.saveCheckpoint?.(next);
  };

  if (sectionPlan.length === 0) {
    if (
      callsStarted >= MARKDOWN_LONGFORM_MAX_CALLS ||
      MARKDOWN_LONGFORM_MAX_PLAN_OUTPUT_TOKENS >
        MARKDOWN_LONGFORM_OUTPUT_TOKEN_BUDGET
    ) {
      throw new MarkdownDocumentGenerationFailure('model_output_limit');
    }
    const planOperationId = `${input.operationId}:longform:plan`;
    callsStarted += 1;
    reservedOutputTokens += MARKDOWN_LONGFORM_MAX_PLAN_OUTPUT_TOKENS;
    await persistCheckpoint({
      operationId: planOperationId,
      maxOutputTokens: MARKDOWN_LONGFORM_MAX_PLAN_OUTPUT_TOKENS,
    });
    const plan = await invokeReservedModel(
      gateway,
      {
        taskAlias: 'artifact.generate',
        modelAlias: 'structured',
        schema: longformPlanSchema,
        promptVersion: `${input.revision ? MARKDOWN_DOCUMENT_REVISION_PROMPT_VERSION : MARKDOWN_DOCUMENT_PROMPT_VERSION}:plan-v1`,
        traceId: input.traceId,
        operationId: planOperationId,
        maxOutputTokens: MARKDOWN_LONGFORM_MAX_PLAN_OUTPUT_TOKENS,
        messages: planMessages,
      },
      async () => {
        reservedOutputTokens -= MARKDOWN_LONGFORM_MAX_PLAN_OUTPUT_TOKENS;
        await persistCheckpoint(null);
      },
    );
    if (
      plan.metadata.usage.outputTokens >
      MARKDOWN_LONGFORM_MAX_PLAN_OUTPUT_TOKENS
    ) {
      throw new MarkdownDocumentGenerationFailure('model_output_limit');
    }
    usage = mergeUsage(usage, {
      calls: 1,
      inputTokens: plan.metadata.usage.inputTokens,
      outputTokens: plan.metadata.usage.outputTokens,
      totalTokens:
        plan.metadata.usage.inputTokens + plan.metadata.usage.outputTokens,
    });
    reservedOutputTokens -= MARKDOWN_LONGFORM_MAX_PLAN_OUTPUT_TOKENS;
    sourceSummary = plan.output.sourceSummary;
    sectionPlan = plan.output.sections;
    await persistCheckpoint(null);
  }
  if (
    usage.outputTokens + reservedOutputTokens >
    MARKDOWN_LONGFORM_OUTPUT_TOKEN_BUDGET
  ) {
    throw new MarkdownDocumentGenerationFailure('model_output_limit');
  }

  let precedingSummary = sourceSummary;
  for (const [index, section] of sectionPlan.entries()) {
    const completed = completedSections.find((entry) => entry.index === index);
    if (completed) {
      precedingSummary = completed.continuationSummary;
      continue;
    }
    if (index + 2 > MARKDOWN_LONGFORM_MAX_CALLS) {
      throw new Error('markdown_document_segment_limit');
    }
    const sectionMessages = buildSectionMessages({
      title: input.title,
      index: index + 1,
      total: sectionPlan.length,
      sectionTitle: section.title,
      focus: section.focus,
      sourceSummary,
      precedingSummary,
    });
    const remainingSections = sectionPlan.length - index;
    const remainingOutputBudget =
      MARKDOWN_LONGFORM_OUTPUT_TOKEN_BUDGET -
      usage.outputTokens -
      reservedOutputTokens;
    const maxOutputTokens = Math.min(
      MARKDOWN_LONGFORM_OUTPUT_TOKEN_BUDGET,
      Math.floor(remainingOutputBudget / remainingSections),
    );
    if (
      callsStarted >= MARKDOWN_LONGFORM_MAX_CALLS ||
      maxOutputTokens < 1 ||
      usage.outputTokens + reservedOutputTokens + maxOutputTokens >
        MARKDOWN_LONGFORM_OUTPUT_TOKEN_BUDGET
    ) {
      throw new MarkdownDocumentGenerationFailure('model_output_limit');
    }
    const operationId = `${input.operationId}:longform:section:${index + 1}`;
    callsStarted += 1;
    reservedOutputTokens += maxOutputTokens;
    await persistCheckpoint({ operationId, maxOutputTokens });
    const result = await invokeReservedModel(
      gateway,
      {
        taskAlias: 'artifact.generate',
        modelAlias: 'structured',
        schema: longformSectionSchema,
        promptVersion: `${input.revision ? MARKDOWN_DOCUMENT_REVISION_PROMPT_VERSION : MARKDOWN_DOCUMENT_PROMPT_VERSION}:section-v1`,
        traceId: input.traceId,
        operationId,
        maxOutputTokens,
        messages: sectionMessages,
      },
      async () => {
        reservedOutputTokens -= maxOutputTokens;
        await persistCheckpoint(null);
      },
    );
    usage = mergeUsage(usage, {
      calls: 1,
      inputTokens: result.metadata.usage.inputTokens,
      outputTokens: result.metadata.usage.outputTokens,
      totalTokens:
        result.metadata.usage.inputTokens + result.metadata.usage.outputTokens,
    });
    if (result.metadata.usage.outputTokens > maxOutputTokens) {
      throw new MarkdownDocumentGenerationFailure('model_output_limit');
    }
    reservedOutputTokens -= maxOutputTokens;
    completedSections.push({
      index,
      markdown: result.output.markdown.trim(),
      continuationSummary: result.output.continuationSummary,
    });
    precedingSummary = result.output.continuationSummary;
    await persistCheckpoint(null);
  }

  const markdown = [
    `# ${input.title}`,
    '',
    ...sectionPlan.map((section, index) => {
      const completed = completedSections.find(
        (entry) => entry.index === index,
      );
      if (!completed) {
        throw new MarkdownDocumentGenerationFailure('invalid_output');
      }
      return `## ${section.title}\n\n${completed.markdown}`;
    }),
  ].join('\n\n');
  if (markdown.length > MARKDOWN_DOCUMENT_MAX_CHARS) {
    throw new MarkdownDocumentGenerationFailure('model_output_limit');
  }
  if (hasCollapsedMarkdownBlocks(markdown)) {
    throw new MarkdownDocumentGenerationFailure('invalid_output');
  }

  const parsedContent = markdownDocumentContentSchema.safeParse({
    contentVersion: MARKDOWN_DOCUMENT_CONTENT_VERSION,
    markdown,
    generatedByModel: true,
  });
  if (!parsedContent.success) {
    throw new MarkdownDocumentGenerationFailure('invalid_output');
  }
  return {
    content: parsedContent.data,
    usage,
  };
}
