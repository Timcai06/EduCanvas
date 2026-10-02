import {
  ModelGatewayInvocationError,
  type StructuredModelGateway,
  type StructuredModelRequest,
  type StructuredModelResult,
} from '@educanvas/agent-core';
import { MARKDOWN_DOCUMENT_MAX_CHARS } from '@educanvas/canvas-protocol';
import { z } from 'zod';
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
export const MARKDOWN_LONGFORM_MAX_PLAN_OUTPUT_TOKENS = 1_024;

export interface ArtifactRevisionContext {
  instruction: string;
  baseContent: unknown;
}

const MAX_TRANSCRIPT_CHARS = 12_000;

const longformSectionPlanSchema = z.object({
  title: z.string().min(1).max(120),
  focus: z.string().min(1).max(800),
});

export const longformPlanSchema = z.object({
  sourceSummary: z.string().min(1).max(1_200),
  sections: z
    .array(longformSectionPlanSchema)
    .min(1)
    .max(MARKDOWN_LONGFORM_MAX_CALLS - 1),
});

export const longformSectionSchema = z.object({
  markdown: z.string().min(1).max(MARKDOWN_DOCUMENT_MAX_CHARS),
  continuationSummary: z.string().min(1).max(1_200),
});

const checkpointSectionsSchema = z
  .array(longformSectionPlanSchema)
  .max(MARKDOWN_LONGFORM_MAX_CALLS - 1);

export const longformCheckpointSchema = z
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

export type LongformUsage = {
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

export function mergeUsage(
  total: LongformUsage,
  usage: LongformUsage,
): LongformUsage {
  return {
    calls: total.calls + usage.calls,
    inputTokens: total.inputTokens + usage.inputTokens,
    outputTokens: total.outputTokens + usage.outputTokens,
    totalTokens: total.totalTokens + usage.totalTokens,
  };
}

export async function invokeReservedModel<Output>(
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

export const clip = (value: string, max: number): string =>
  value.length <= max ? value : `${value.slice(0, max - 1)}…`;

const stripCodeBlocks = (markdown: string): string => {
  return markdown.replace(/```[\s\S]*?```/g, '');
};

const stripInlineCode = (markdown: string): string =>
  markdown.replace(/`[^`]*`/g, '');

export const hasCollapsedMarkdownBlocks = (markdown: string): boolean => {
  const sanitized = stripInlineCode(stripCodeBlocks(markdown));
  return /\\n(?:\\n)*(?:#{1,6}\s|[-*+]\s|>\s|\d+\.\s)/.test(sanitized);
};

export const buildTranscript = (
  messages: readonly OutlineSourceMessage[],
): string => {
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
