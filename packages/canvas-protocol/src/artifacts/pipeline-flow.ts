import { z } from 'zod';

/** Human-authored renderer slots. Model output can reference only this closed set. */
export const pipelineFlowSlots = [
  'input',
  'feature_extraction',
  'classification',
  'output',
] as const;

export const pipelineFlowSlotSchema = z.enum(pipelineFlowSlots);

const pipelineFlowStepSchema = z
  .object({
    slot: pipelineFlowSlotSchema,
    label: z.string().trim().min(1).max(40),
    narration: z.string().trim().min(1).max(240),
  })
  .strict();

const canonicalSlotIndex = new Map(
  pipelineFlowSlots.map((slot, index) => [slot, index]),
);

/**
 * `pipeline_flow` is a semantic teaching contract, not an animation DSL.
 * Durations, selectors, CSS properties and GSAP instructions are deliberately
 * absent; the renderer owns every visual and timing decision.
 */
export const pipelineFlowParamsSchema = z
  .object({
    templateKey: z.literal('pipeline_flow'),
    objective: z.string().trim().min(1).max(240),
    steps: z.array(pipelineFlowStepSchema).min(3).max(4),
    highlightOrder: z.array(pipelineFlowSlotSchema).min(3).max(4),
    pausePoints: z.array(pipelineFlowSlotSchema).max(4),
    completionMessage: z.string().trim().min(1).max(240).optional(),
  })
  .strict()
  .superRefine((params, context) => {
    const stepSlots = params.steps.map((step) => step.slot);
    const uniqueStepSlots = new Set(stepSlots);
    const uniqueHighlightSlots = new Set(params.highlightOrder);
    const uniquePausePoints = new Set(params.pausePoints);

    if (uniqueStepSlots.size !== stepSlots.length) {
      context.addIssue({
        code: 'custom',
        path: ['steps'],
        message: '同一语义槽位只能声明一次',
      });
    }
    if (!uniqueStepSlots.has('input') || !uniqueStepSlots.has('output')) {
      context.addIssue({
        code: 'custom',
        path: ['steps'],
        message: 'pipeline_flow必须包含input和output槽位',
      });
    }
    if (uniqueHighlightSlots.size !== params.highlightOrder.length) {
      context.addIssue({
        code: 'custom',
        path: ['highlightOrder'],
        message: '高亮顺序不能重复槽位',
      });
    }
    if (
      params.highlightOrder.length !== stepSlots.length ||
      params.highlightOrder.some((slot) => !uniqueStepSlots.has(slot))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['highlightOrder'],
        message: '高亮顺序必须且只能包含已声明步骤',
      });
    }
    const highlightIndexes = params.highlightOrder.map(
      (slot) => canonicalSlotIndex.get(slot) ?? -1,
    );
    if (
      highlightIndexes.some(
        (index, position) =>
          position > 0 && index <= (highlightIndexes[position - 1] ?? -1),
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['highlightOrder'],
        message: '流程必须遵循输入、特征、分类、输出的教学顺序',
      });
    }
    if (uniquePausePoints.size !== params.pausePoints.length) {
      context.addIssue({
        code: 'custom',
        path: ['pausePoints'],
        message: '暂停点不能重复',
      });
    }
    params.pausePoints.forEach((slot, index) => {
      if (!uniqueHighlightSlots.has(slot)) {
        context.addIssue({
          code: 'custom',
          path: ['pausePoints', index],
          message: '暂停点必须引用高亮顺序中的槽位',
        });
      }
    });
  });

export type PipelineFlowSlot = z.infer<typeof pipelineFlowSlotSchema>;
export type PipelineFlowParams = z.infer<typeof pipelineFlowParamsSchema>;
