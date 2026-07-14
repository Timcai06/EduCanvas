import { describe, expect, it } from 'vitest';
import { domainLearningEventSchema } from './domain-events';

const eventBase = {
  schemaVersion: '1',
  eventId: '11111111-1111-4111-8111-111111111111',
  idempotencyKey: 'session-1:1',
  studentId: 'student-1',
  sessionId: '22222222-2222-4222-8222-222222222222',
  knowledgeNodeId: 'cat-dog-features',
  sequence: 1,
  occurredAt: '2026-07-14T08:00:00.000Z',
  recordedAt: '2026-07-14T08:00:00.100Z',
  source: 'teaching_runtime',
  causationId: 'client-event-1',
} as const;

describe('domainLearningEventSchema', () => {
  it.each([
    {
      ...eventBase,
      eventType: 'state_transition',
      payload: { from: 'EXPLAIN', to: 'DEMONSTRATE', reason: '讲解完成' },
    },
    {
      ...eventBase,
      source: 'grading_service',
      eventType: 'assessment_graded',
      payload: {
        artifactId: 'quiz-1',
        assessmentType: 'quiz',
        attemptedItems: 3,
        correctItems: 2,
        usedHint: false,
      },
    },
    {
      ...eventBase,
      eventType: 'hint_recorded',
      payload: { contextType: 'quiz', contextId: 'question-1', hintLevel: 1 },
    },
    {
      ...eventBase,
      source: 'misconception_service',
      eventType: 'misconception_updated',
      payload: {
        tag: 'TRAINS_DURING_USE',
        status: 'active',
        evidenceQuote: '模型会一边用一边训练',
        confidence: 0.9,
      },
    },
    {
      ...eventBase,
      eventType: 'artifact_completed',
      payload: { artifactId: 'animation-1', artifactType: 'pipeline_flow' },
    },
  ])('接受可信事件$eventType', (event) => {
    expect(domainLearningEventSchema.safeParse(event).success).toBe(true);
  });

  it('拒绝客户端式自报字段和未知payload', () => {
    const result = domainLearningEventSchema.safeParse({
      ...eventBase,
      source: 'grading_service',
      eventType: 'assessment_graded',
      payload: {
        artifactId: 'quiz-1',
        assessmentType: 'quiz',
        attemptedItems: 1,
        correctItems: 1,
        usedHint: false,
        masteryScore: 1,
      },
    });

    expect(result.success).toBe(false);
  });

  it('拒绝正确数超过作答数', () => {
    const result = domainLearningEventSchema.safeParse({
      ...eventBase,
      source: 'grading_service',
      eventType: 'assessment_graded',
      payload: {
        artifactId: 'quiz-1',
        assessmentType: 'quiz',
        attemptedItems: 1,
        correctItems: 2,
        usedHint: false,
      },
    });

    expect(result.success).toBe(false);
  });

  it('拒绝把ADVANCE伪装成持久状态', () => {
    const result = domainLearningEventSchema.safeParse({
      ...eventBase,
      eventType: 'state_transition',
      payload: { from: 'ASSESS', to: 'ADVANCE', reason: '通过测评' },
    });

    expect(result.success).toBe(false);
  });
});
