import { describe, expect, it } from 'vitest';
import { validateArtifact } from './artifact';

const validClassificationGame = {
  schemaVersion: '1',
  artifactId: 'classification-1',
  type: 'classification_game',
  title: '猫狗分类',
  params: {
    prompt: '请完成分类',
    categories: [
      { id: 'cat', label: '猫' },
      { id: 'dog', label: '狗' },
    ],
    items: [
      { id: 'cat-1', label: '橘猫', emoji: '🐱', correctCategoryId: 'cat' },
      { id: 'dog-1', label: '柴犬', emoji: '🐶', correctCategoryId: 'dog' },
    ],
  },
} as const;

const validQuiz = {
  schemaVersion: '1',
  artifactId: 'quiz-1',
  type: 'quiz',
  title: '特征测验',
  params: {
    questions: [
      {
        id: 'question-1',
        question: '分类模型主要根据什么判断？',
        options: [
          { id: 'a', text: '输入特征' },
          { id: 'b', text: '随机猜测' },
        ],
        correctOptionId: 'a',
      },
    ],
  },
} as const;

describe('validateArtifact', () => {
  it('接受阶段一合法Artifact', () => {
    expect(validateArtifact(validClassificationGame).ok).toBe(true);
    expect(validateArtifact(validQuiz).ok).toBe(true);
  });

  it('拒绝未知字段', () => {
    expect(validateArtifact({ ...validQuiz, html: '<script />' }).ok).toBe(
      false,
    );
  });

  it('拒绝不存在的正确答案引用', () => {
    const artifact = structuredClone(validQuiz);
    artifact.params.questions[0].correctOptionId = 'missing';

    expect(validateArtifact(artifact).ok).toBe(false);
  });

  it('拒绝重复的类别、项目、题目和选项标识', () => {
    const classification = structuredClone(validClassificationGame);
    classification.params.categories[1].id = 'cat';
    classification.params.items[1].id = 'cat-1';

    const quiz = structuredClone(validQuiz);
    quiz.params.questions.push(structuredClone(quiz.params.questions[0]));
    quiz.params.questions[0].options[1].id = 'a';

    expect(validateArtifact(classification).ok).toBe(false);
    expect(validateArtifact(quiz).ok).toBe(false);
  });

  it('拒绝未知类型和协议版本', () => {
    expect(validateArtifact({ ...validQuiz, type: 'step_animation' }).ok).toBe(
      false,
    );
    expect(validateArtifact({ ...validQuiz, schemaVersion: '2' }).ok).toBe(
      false,
    );
  });
});
