import type { StructuredModelGateway } from '@educanvas/agent-core';
import { createHash } from 'node:crypto';
import {
  MARKDOWN_DOCUMENT_CONTENT_VERSION,
  MARKDOWN_DOCUMENT_KIND,
  MARKDOWN_DOCUMENT_MAX_CHARS,
  markdownDocumentContentSchema,
  type MarkdownDocumentContent,
} from '@educanvas/canvas-protocol';
import {
  MARKDOWN_DOCUMENT_PROMPT_VERSION,
  MARKDOWN_DOCUMENT_REVISION_PROMPT_VERSION,
  MARKDOWN_LONGFORM_MAX_CALLS,
  MARKDOWN_LONGFORM_OUTPUT_TOKEN_BUDGET,
  MARKDOWN_LONGFORM_CHECKPOINT_VERSION,
  MARKDOWN_LONGFORM_MAX_PLAN_OUTPUT_TOKENS,
  longformPlanSchema,
  longformSectionSchema,
  longformCheckpointSchema,
  MarkdownDocumentGenerationFailure,
  mergeUsage,
  invokeReservedModel,
  clip,
  hasCollapsedMarkdownBlocks,
  type ArtifactRevisionContext,
  type MarkdownLongformCheckpoint,
  type LongformUsage,
} from './markdown-generation-policy.js';

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

export async function generateMarkdownLongform(args: {
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
