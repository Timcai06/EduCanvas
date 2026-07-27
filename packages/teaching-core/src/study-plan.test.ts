import { describe, expect, it } from 'vitest';
import {
  gradeDiagnostic,
  projectPublicDiagnostic,
  studyCourseDefinitionSchema,
  type StudyCourseDefinition,
} from './study-plan';

const course: StudyCourseDefinition = {
  courseSlug: 'cat-dog-ai',
  version: 'v1',
  gradeBand: 'primary_school',
  title: '机器如何识别猫和狗',
  objectives: Array.from({ length: 6 }, (_value, index) => ({
    objectiveKey: `objective-${index + 1}`,
    knowledgeNodeId: `cat-dog-ai:v1:primary:node-${index + 1}`,
    title: `目标${index + 1}`,
    description: `理解第${index + 1}个目标`,
    sequence: index + 1,
    prerequisiteObjectiveKeys: index === 0 ? [] : [`objective-${index}`],
  })),
  diagnostic: {
    version: 'diagnostic-v1',
    questions: Array.from({ length: 4 }, (_value, index) => ({
      questionId: `question-${index + 1}`,
      objectiveKey: `objective-${index + 1}`,
      prompt: `问题${index + 1}`,
      options: [
        { id: 'a', text: '选项A' },
        { id: 'b', text: '选项B' },
      ],
      correctOptionId: 'a',
    })),
  },
};

describe('学习目标图与诊断', () => {
  it('拒绝不存在或晚于当前节点的先修关系', () => {
    const invalid: StudyCourseDefinition = JSON.parse(
      JSON.stringify(course),
    ) as StudyCourseDefinition;
    invalid.objectives[1]!.prerequisiteObjectiveKeys = ['objective-3'];

    expect(studyCourseDefinitionSchema.safeParse(invalid).success).toBe(false);
  });

  it('公开诊断不包含答案与目标内部标识', () => {
    const projected = projectPublicDiagnostic(course);
    expect(projected.questions).toHaveLength(4);
    expect(projected.questions[0]).not.toHaveProperty('correctOptionId');
    expect(projected.questions[0]).not.toHaveProperty('objectiveKey');
  });

  it('确定性生成优势、重点和未开始三态进度', () => {
    const decision = gradeDiagnostic(course, {
      attemptId: '11111111-1111-4111-8111-111111111111',
      answers: [
        { questionId: 'question-1', selectedOptionId: 'a' },
        { questionId: 'question-2', selectedOptionId: 'b' },
        { questionId: 'question-3', selectedOptionId: 'a' },
        { questionId: 'question-4', selectedOptionId: 'b' },
      ],
    });

    expect(decision).toMatchObject({
      ok: true,
      result: {
        attemptedItems: 4,
        correctItems: 2,
        nextObjectiveKey: 'objective-2',
        progress: [
          { objectiveKey: 'objective-1', status: 'strength' },
          { objectiveKey: 'objective-2', status: 'focus' },
          { objectiveKey: 'objective-3', status: 'strength' },
          { objectiveKey: 'objective-4', status: 'focus' },
          { objectiveKey: 'objective-5', status: 'not_started' },
          { objectiveKey: 'objective-6', status: 'not_started' },
        ],
      },
    });
  });

  it('拒绝缺题、未知题和未知选项', () => {
    expect(
      gradeDiagnostic(course, {
        attemptId: '11111111-1111-4111-8111-111111111111',
        answers: [
          { questionId: 'question-1', selectedOptionId: 'a' },
          { questionId: 'question-2', selectedOptionId: 'a' },
          { questionId: 'question-3', selectedOptionId: 'a' },
        ],
      }),
    ).toEqual({ ok: false, code: 'INCOMPLETE_DIAGNOSTIC' });

    expect(
      gradeDiagnostic(course, {
        attemptId: '11111111-1111-4111-8111-111111111111',
        answers: [
          { questionId: 'question-1', selectedOptionId: 'a' },
          { questionId: 'question-2', selectedOptionId: 'a' },
          { questionId: 'question-3', selectedOptionId: 'a' },
          { questionId: 'unknown', selectedOptionId: 'a' },
        ],
      }),
    ).toEqual({ ok: false, code: 'UNKNOWN_QUESTION' });

    expect(
      gradeDiagnostic(course, {
        attemptId: '11111111-1111-4111-8111-111111111111',
        answers: [
          { questionId: 'question-1', selectedOptionId: 'a' },
          { questionId: 'question-2', selectedOptionId: 'a' },
          { questionId: 'question-3', selectedOptionId: 'a' },
          { questionId: 'question-4', selectedOptionId: 'unknown' },
        ],
      }),
    ).toEqual({ ok: false, code: 'UNKNOWN_OPTION' });
  });
});
