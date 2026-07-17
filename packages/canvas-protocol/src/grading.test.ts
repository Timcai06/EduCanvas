import { describe, expect, it } from 'vitest';
import {
  gradeCanvasSubmission,
  prepareArtifact,
  projectRenderableArtifact,
} from './grading';

const quizArtifact = {
  schemaVersion: '1',
  artifactId: 'quiz-1',
  type: 'quiz',
  title: '机器学习小测',
  params: {
    questions: [
      {
        id: 'q1',
        question: '训练数据的作用是什么？',
        options: [
          { id: 'a', text: '提供学习样例' },
          { id: 'b', text: '保证永远正确' },
        ],
        correctOptionId: 'a',
        explanation: '模型从样例中寻找规律。',
      },
    ],
  },
} as const;

const classificationArtifact = {
  schemaVersion: '1',
  artifactId: 'classification-1',
  type: 'classification_game',
  title: '猫狗分类',
  params: {
    prompt: '完成分类',
    categories: [
      { id: 'cat', label: '猫' },
      { id: 'dog', label: '狗' },
    ],
    items: [
      { id: 'i1', label: '橘猫', emoji: '🐱', correctCategoryId: 'cat' },
      { id: 'i2', label: '柴犬', emoji: '🐶', correctCategoryId: 'dog' },
    ],
    successMessage: '分类正确',
  },
} as const;

const pipelineArtifact = {
  schemaVersion: '1',
  artifactId: 'pipeline-1',
  type: 'pipeline_flow',
  title: '图像分类流程',
  params: {
    templateKey: 'pipeline_flow',
    objective: '观察模型如何完成分类',
    steps: [
      { slot: 'input', label: '输入', narration: '接收图片。' },
      { slot: 'classification', label: '分类', narration: '比较特征。' },
      { slot: 'output', label: '输出', narration: '显示类别。' },
    ],
    highlightOrder: ['input', 'classification', 'output'],
    pausePoints: ['classification'],
  },
} as const;

const eventBase = {
  schemaVersion: '1',
  eventId: '11111111-1111-4111-8111-111111111111',
  occurredAt: '2026-07-14T06:00:00.000Z',
} as const;

describe('公开Artifact与私有判分键', () => {
  it('从浏览器投影中移除正确答案与解析', () => {
    const prepared = prepareArtifact(quizArtifact);

    expect(prepared.publicArtifact).not.toHaveProperty(
      'params.questions.0.correctOptionId',
    );
    expect(prepared.publicArtifact).not.toHaveProperty(
      'params.questions.0.explanation',
    );
    expect(prepared.gradingKey).toMatchObject({
      type: 'quiz',
      questions: [{ correctOptionId: 'a' }],
    });
  });

  it('从分类项目中移除正确类别', () => {
    const prepared = prepareArtifact(classificationArtifact);

    expect(prepared.publicArtifact).not.toHaveProperty(
      'params.items.0.correctCategoryId',
    );
    expect(prepared.gradingKey).toHaveProperty(
      'items.0',
      expect.objectContaining({ itemId: 'i1', correctCategoryId: 'cat' }),
    );
  });

  it('允许render-only投影，但拒绝伪造判分键', () => {
    expect(projectRenderableArtifact(pipelineArtifact)).toEqual(
      pipelineArtifact,
    );
    expect(() => prepareArtifact(pipelineArtifact)).toThrow();
  });
});

describe('服务端确定性判分', () => {
  it('使用保存的Quiz判分键而非客户端自报结果', () => {
    const { gradingKey } = prepareArtifact(quizArtifact);
    const decision = gradeCanvasSubmission(gradingKey, {
      ...eventBase,
      artifactId: 'quiz-1',
      type: 'quiz_answer_submitted',
      payload: { questionId: 'q1', selectedOptionId: 'a' },
    });

    expect(decision).toMatchObject({
      ok: true,
      result: { attemptedItems: 1, correctItems: 1 },
    });
  });

  it('拒绝不存在的选项而不是把它计为答错', () => {
    const { gradingKey } = prepareArtifact(quizArtifact);
    expect(
      gradeCanvasSubmission(gradingKey, {
        ...eventBase,
        artifactId: 'quiz-1',
        type: 'quiz_answer_submitted',
        payload: { questionId: 'q1', selectedOptionId: 'missing' },
      }),
    ).toEqual({ ok: false, code: 'UNKNOWN_CHOICE' });
  });

  it('分类题必须完整提交且逐项确定性判分', () => {
    const { gradingKey } = prepareArtifact(classificationArtifact);
    expect(
      gradeCanvasSubmission(gradingKey, {
        ...eventBase,
        artifactId: 'classification-1',
        type: 'classification_submitted',
        payload: {
          assignments: [
            { itemId: 'i1', categoryId: 'cat' },
            { itemId: 'i2', categoryId: 'cat' },
          ],
        },
      }),
    ).toMatchObject({
      ok: true,
      result: { attemptedItems: 2, correctItems: 1 },
    });

    expect(
      gradeCanvasSubmission(gradingKey, {
        ...eventBase,
        artifactId: 'classification-1',
        type: 'classification_submitted',
        payload: { assignments: [{ itemId: 'i1', categoryId: 'cat' }] },
      }),
    ).toEqual({ ok: false, code: 'INCOMPLETE_SUBMISSION' });
  });

  it('普通动画交互不能产生assessment判分成功', () => {
    const { gradingKey } = prepareArtifact(quizArtifact);
    expect(
      gradeCanvasSubmission(gradingKey, {
        ...eventBase,
        artifactId: 'quiz-1',
        type: 'animation_step_completed',
        payload: {
          templateKey: 'pipeline_flow',
          stepId: 'output',
          stepIndex: 3,
        },
      }),
    ).toEqual({ ok: false, code: 'EVENT_TYPE_MISMATCH' });
  });
});
