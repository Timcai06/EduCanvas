import 'server-only';

import type { Artifact } from '@educanvas/canvas-protocol/server';
import type { StudyCourseDefinition } from '@educanvas/teaching-core';

export const legacyHighImageAiCourse = {
  courseSlug: 'image-ai-high',
  version: 'v1',
  gradeBand: 'high_school',
  title: '图像分类模型评估',
  objectives: [
    {
      objectiveKey: 'feature-representation',
      knowledgeNodeId: 'image-ai-high.feature-representation',
      title: '特征表示',
      description: '解释原始图像如何转化为可供分类模型使用的数值表示。',
      sequence: 1,
      prerequisiteObjectiveKeys: [],
    },
    {
      objectiveKey: 'dataset-partitions',
      knowledgeNodeId: 'image-ai-high.dataset-partitions',
      title: '数据集划分',
      description: '区分训练、验证和测试数据各自承担的评估职责。',
      sequence: 2,
      prerequisiteObjectiveKeys: ['feature-representation'],
    },
    {
      objectiveKey: 'model-fitting',
      knowledgeNodeId: 'image-ai-high.model-fitting',
      title: '模型拟合',
      description: '理解参数如何根据训练误差调整并形成决策规则。',
      sequence: 3,
      prerequisiteObjectiveKeys: ['feature-representation'],
    },
    {
      objectiveKey: 'confusion-matrix',
      knowledgeNodeId: 'image-ai-high.confusion-matrix',
      title: '混淆矩阵',
      description: '用真阳性、假阳性、真阴性和假阴性分析分类错误。',
      sequence: 4,
      prerequisiteObjectiveKeys: ['dataset-partitions'],
    },
    {
      objectiveKey: 'overfitting',
      knowledgeNodeId: 'image-ai-high.overfitting',
      title: '识别过拟合',
      description: '根据训练与验证表现的差异判断模型是否只记住训练样本。',
      sequence: 5,
      prerequisiteObjectiveKeys: ['model-fitting', 'confusion-matrix'],
    },
    {
      objectiveKey: 'bias-generalization',
      knowledgeNodeId: 'image-ai-high.bias-generalization',
      title: '偏差与泛化',
      description: '分析数据分布偏差如何影响模型在真实场景中的泛化能力。',
      sequence: 6,
      prerequisiteObjectiveKeys: ['overfitting'],
    },
  ],
  diagnostic: {
    version: 'v1',
    questions: [
      {
        questionId: 'high-q1',
        objectiveKey: 'feature-representation',
        prompt: '图像分类模型通常不能直接理解“猫”这个概念，它首先处理什么？',
        options: [
          { id: 'h1-numbers', text: '由像素等信息形成的数值表示' },
          { id: 'h1-intent', text: '拍摄者没有说出的意图' },
          { id: 'h1-filename', text: '只处理文件名中的文字' },
        ],
        correctOptionId: 'h1-numbers',
      },
      {
        questionId: 'high-q2',
        objectiveKey: 'dataset-partitions',
        prompt: '验证集最主要的用途是什么？',
        options: [
          { id: 'h2-tune', text: '在开发过程中选择模型和超参数' },
          { id: 'h2-final', text: '替代所有最终测试' },
          { id: 'h2-label', text: '自动生成训练标签' },
        ],
        correctOptionId: 'h2-tune',
      },
      {
        questionId: 'high-q3',
        objectiveKey: 'confusion-matrix',
        prompt: '真实是“狗”、模型却预测为“猫”，这条记录属于什么？',
        options: [
          { id: 'h3-error', text: '一个分类错误，应进入混淆矩阵' },
          { id: 'h3-correct', text: '正确预测，不需要记录' },
          { id: 'h3-missing', text: '训练数据自动缺失' },
        ],
        correctOptionId: 'h3-error',
      },
      {
        questionId: 'high-q4',
        objectiveKey: 'overfitting',
        prompt: '训练准确率很高、验证准确率明显较低，最可能说明什么？',
        options: [
          { id: 'h4-overfit', text: '模型可能过拟合' },
          { id: 'h4-perfect', text: '模型已经完美泛化' },
          { id: 'h4-no-data', text: '模型没有使用任何训练数据' },
        ],
        correctOptionId: 'h4-overfit',
      },
    ],
  },
} satisfies StudyCourseDefinition;

export const highImageAiCourse: StudyCourseDefinition = {
  ...legacyHighImageAiCourse,
  version: 'v2',
};

export const highImageAiArtifact = {
  schemaVersion: '1',
  artifactId: 'image-ai-high-model-evaluation-v2',
  type: 'quiz',
  title: '模型评估与过拟合测验',
  params: {
    questions: [
      {
        id: 'validation-role',
        question: '验证集在模型开发中的主要职责是什么？',
        options: [
          { id: 'tune', text: '选择模型与超参数' },
          { id: 'train', text: '替代全部训练数据' },
          { id: 'publish', text: '直接作为最终上线结论' },
        ],
        correctOptionId: 'tune',
        explanation: '验证集服务于开发期选择；测试集应保留到最终评估。',
      },
      {
        id: 'overfitting-signal',
        question: '训练准确率 99%、验证准确率 68%，最值得优先检查什么？',
        options: [
          { id: 'overfit', text: '模型是否过拟合训练样本' },
          { id: 'perfect', text: '模型是否已经完美泛化' },
          { id: 'labels', text: '准确率是否应该超过 100%' },
        ],
        correctOptionId: 'overfit',
        explanation: '训练与验证表现差距过大是典型的过拟合信号。',
      },
      {
        id: 'confusion-matrix',
        question: '真实为“狗”但模型预测为“猫”的样例应该记录在哪里？',
        options: [
          { id: 'confusion', text: '混淆矩阵的误分类项' },
          { id: 'correct', text: '正确预测项' },
          { id: 'ignored', text: '直接忽略，不参与评估' },
        ],
        correctOptionId: 'confusion',
        explanation:
          '混淆矩阵保留具体类别之间的错误方向，比单一准确率信息更多。',
      },
    ],
  },
} satisfies Artifact;
