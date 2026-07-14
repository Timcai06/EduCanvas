import { describe, expect, it } from 'vitest';
import { canvasInteractionEventSchema } from './events';

const eventBase = {
  schemaVersion: '1',
  eventId: '11111111-1111-4111-8111-111111111111',
  artifactId: 'artifact-1',
  occurredAt: '2026-07-14T08:00:00.000Z',
} as const;

describe('canvasInteractionEventSchema', () => {
  it.each([
    {
      ...eventBase,
      type: 'artifact_rendered',
      payload: { artifactType: 'quiz' },
    },
    {
      ...eventBase,
      type: 'animation_started',
      payload: { templateKey: 'pipeline_flow', stepId: 'input' },
    },
    {
      ...eventBase,
      type: 'animation_paused',
      payload: { templateKey: 'pipeline_flow', positionMs: 1200 },
    },
    {
      ...eventBase,
      type: 'animation_step_completed',
      payload: {
        templateKey: 'pipeline_flow',
        stepId: 'features',
        stepIndex: 1,
      },
    },
    {
      ...eventBase,
      type: 'hint_requested',
      payload: { contextType: 'quiz', contextId: 'question-1' },
    },
    {
      ...eventBase,
      type: 'quiz_answer_submitted',
      payload: { questionId: 'question-1', selectedOptionId: 'option-a' },
    },
    {
      ...eventBase,
      type: 'classification_submitted',
      payload: {
        assignments: [
          { itemId: 'cat-1', categoryId: 'cat' },
          { itemId: 'dog-1', categoryId: 'dog' },
        ],
      },
    },
  ])('接受受控事件$type', (event) => {
    expect(canvasInteractionEventSchema.safeParse(event).success).toBe(true);
  });

  it('拒绝客户端自报判分结果', () => {
    const result = canvasInteractionEventSchema.safeParse({
      ...eventBase,
      type: 'quiz_answer_submitted',
      payload: {
        questionId: 'question-1',
        selectedOptionId: 'option-a',
        isCorrect: true,
      },
    });

    expect(result.success).toBe(false);
  });

  it('拒绝同一分类项目提交多次', () => {
    const result = canvasInteractionEventSchema.safeParse({
      ...eventBase,
      type: 'classification_submitted',
      payload: {
        assignments: [
          { itemId: 'cat-1', categoryId: 'cat' },
          { itemId: 'cat-1', categoryId: 'dog' },
        ],
      },
    });

    expect(result.success).toBe(false);
  });

  it('拒绝未知事件字段和错误版本', () => {
    expect(
      canvasInteractionEventSchema.safeParse({
        ...eventBase,
        unexpected: true,
        type: 'artifact_rendered',
        payload: { artifactType: 'quiz' },
      }).success,
    ).toBe(false);

    expect(
      canvasInteractionEventSchema.safeParse({
        ...eventBase,
        schemaVersion: '2',
        type: 'artifact_rendered',
        payload: { artifactType: 'quiz' },
      }).success,
    ).toBe(false);
  });
});
