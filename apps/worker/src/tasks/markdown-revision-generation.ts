import type { StructuredModelGateway } from '@educanvas/agent-core';
import { createHash } from 'node:crypto';
import {
  MARKDOWN_DOCUMENT_CONTENT_VERSION,
  MARKDOWN_DOCUMENT_MAX_CHARS,
  markdownDocumentContentSchema,
  type MarkdownDocumentContent,
} from '@educanvas/canvas-protocol';
import type { OutlineSourceMessage } from './mind-map-outline.js';
import {
  MARKDOWN_DOCUMENT_REVISION_PROMPT_VERSION,
  MARKDOWN_LONGFORM_MAX_CALLS,
  MARKDOWN_LONGFORM_OUTPUT_TOKEN_BUDGET,
  MARKDOWN_LONGFORM_CHECKPOINT_VERSION,
  longformCheckpointSchema,
  MarkdownDocumentGenerationFailure,
  invokeReservedModel,
  clip,
  buildTranscript,
  hasCollapsedMarkdownBlocks,
  type ArtifactRevisionContext,
  type MarkdownLongformCheckpoint,
  type LongformUsage,
} from './markdown-generation-policy.js';

export async function generateMarkdownRevision(input: {
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
