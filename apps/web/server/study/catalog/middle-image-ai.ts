import type { StudyCourseDefinition } from '@educanvas/teaching-core';

export const middleImageAiCourse = {
  courseSlug: 'image-ai-middle',
  version: 'v1',
  gradeBand: 'middle_school',
  title: '图像分类与数据',
  objectives: [
    {
      objectiveKey: 'samples-and-labels',
      knowledgeNodeId: 'image-ai-middle.samples-and-labels',
      title: '样本与标签',
      description: '解释训练样本、输入特征与目标标签在分类任务中的作用。',
      sequence: 1,
      prerequisiteObjectiveKeys: [],
    },
    {
      objectiveKey: 'train-test-split',
      knowledgeNodeId: 'image-ai-middle.train-test-split',
      title: '训练集与测试集',
      description: '理解为什么要用未参与训练的数据检查模型表现。',
      sequence: 2,
      prerequisiteObjectiveKeys: ['samples-and-labels'],
    },
    {
      objectiveKey: 'useful-features',
      knowledgeNodeId: 'image-ai-middle.useful-features',
      title: '选择有效特征',
      description: '判断哪些观察量与分类目标有关，哪些只是偶然噪声。',
      sequence: 3,
      prerequisiteObjectiveKeys: ['samples-and-labels'],
    },
    {
      objectiveKey: 'decision-threshold',
      knowledgeNodeId: 'image-ai-middle.decision-threshold',
      title: '理解判断阈值',
      description: '理解分类分数需要经过阈值才能转成最终类别。',
      sequence: 4,
      prerequisiteObjectiveKeys: ['useful-features'],
    },
    {
      objectiveKey: 'accuracy-and-errors',
      knowledgeNodeId: 'image-ai-middle.accuracy-and-errors',
      title: '评估准确与错误',
      description: '用正确数、总数和典型错误描述模型效果。',
      sequence: 5,
      prerequisiteObjectiveKeys: ['train-test-split', 'decision-threshold'],
    },
    {
      objectiveKey: 'dataset-bias',
      knowledgeNodeId: 'image-ai-middle.dataset-bias',
      title: '发现数据偏差',
      description: '识别样本分布不均衡对不同场景分类结果的影响。',
      sequence: 6,
      prerequisiteObjectiveKeys: ['accuracy-and-errors'],
    },
  ],
  diagnostic: {
    version: 'v1',
    questions: [
      {
        questionId: 'middle-q1',
        objectiveKey: 'samples-and-labels',
        prompt: '在“猫或狗”分类数据中，每张图片对应的“猫/狗”通常称为什么？',
        options: [
          { id: 'm1-label', text: '标签' },
          { id: 'm1-noise', text: '噪声' },
          { id: 'm1-threshold', text: '阈值' },
        ],
        correctOptionId: 'm1-label',
      },
      {
        questionId: 'middle-q2',
        objectiveKey: 'train-test-split',
        prompt: '为什么测试集不应直接拿来训练模型？',
        options: [
          { id: 'm2-color', text: '测试图片的颜色更少' },
          { id: 'm2-unseen', text: '要检查模型面对未见数据的表现' },
          { id: 'm2-storage', text: '这样能节省硬盘空间' },
        ],
        correctOptionId: 'm2-unseen',
      },
      {
        questionId: 'middle-q3',
        objectiveKey: 'useful-features',
        prompt: '判断动物类别时，哪种特征通常比“图片文件名长度”更有用？',
        options: [
          { id: 'm3-ear', text: '耳朵和脸部的形状' },
          { id: 'm3-name', text: '文件名有几个字母' },
          { id: 'm3-folder', text: '文件夹排序位置' },
        ],
        correctOptionId: 'm3-ear',
      },
      {
        questionId: 'middle-q4',
        objectiveKey: 'accuracy-and-errors',
        prompt: '模型在 20 张测试图片中判断对 15 张，准确率是多少？',
        options: [
          { id: 'm4-25', text: '25%' },
          { id: 'm4-75', text: '75%' },
          { id: 'm4-150', text: '150%' },
        ],
        correctOptionId: 'm4-75',
      },
    ],
  },
} satisfies StudyCourseDefinition;
