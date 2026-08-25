import 'server-only';

import type { Artifact } from '@educanvas/canvas-protocol/server';
import type { StudyCourseDefinition } from '@educanvas/teaching-core';

const legacyPrimaryImageAiCourse = {
  courseSlug: 'image-ai-primary',
  version: 'v1',
  title: '图像 AI 入门',
  objectives: [
    {
      objectiveKey: 'observe-features',
      knowledgeNodeId: 'image-ai-primary.observe-features',
      title: '观察可见特征',
      description: '从形状、颜色和局部特征描述图片，而不是只凭感觉判断。',
      sequence: 1,
      prerequisiteObjectiveKeys: [],
    },
    {
      objectiveKey: 'feature-and-label',
      knowledgeNodeId: 'image-ai-primary.feature-and-label',
      title: '区分特征与标签',
      description: '理解特征是观察到的线索，标签是希望模型给出的类别名称。',
      sequence: 2,
      prerequisiteObjectiveKeys: ['observe-features'],
    },
    {
      objectiveKey: 'classify-examples',
      knowledgeNodeId: 'image-ai-primary.classify-examples',
      title: '按规则完成分类',
      description: '使用一致的线索把新图片分到合适的类别。',
      sequence: 3,
      prerequisiteObjectiveKeys: ['feature-and-label'],
    },
    {
      objectiveKey: 'rule-not-memory',
      knowledgeNodeId: 'image-ai-primary.rule-not-memory',
      title: '理解规则不是死记',
      description: '分辨照抄见过的答案和根据共同特征判断新例子的区别。',
      sequence: 4,
      prerequisiteObjectiveKeys: ['classify-examples'],
    },
    {
      objectiveKey: 'uncertain-cases',
      knowledgeNodeId: 'image-ai-primary.uncertain-cases',
      title: '识别不确定情况',
      description: '知道图片模糊或线索不足时，模型可能判断错误并需要更多信息。',
      sequence: 5,
      prerequisiteObjectiveKeys: ['rule-not-memory'],
    },
    {
      objectiveKey: 'balanced-examples',
      knowledgeNodeId: 'image-ai-primary.balanced-examples',
      title: '认识样例公平性',
      description:
        '理解训练样例过少或只覆盖一种情况，会让模型在新图片上表现不好。',
      sequence: 6,
      prerequisiteObjectiveKeys: ['uncertain-cases'],
    },
  ],
  diagnostic: {
    version: 'v1',
    questions: [
      {
        questionId: 'primary-q1',
        objectiveKey: 'observe-features',
        prompt: '观察一张动物图片时，下面哪项属于可以直接看到的特征？',
        options: [
          { id: 'p1-shape', text: '耳朵的形状' },
          { id: 'p1-name', text: '图片文件的名字' },
          { id: 'p1-owner', text: '拍照的人是谁' },
        ],
        correctOptionId: 'p1-shape',
      },
      {
        questionId: 'primary-q2',
        objectiveKey: 'feature-and-label',
        prompt: '把图片分成“猫”和“狗”时，“猫”是什么？',
        options: [
          { id: 'p2-feature', text: '图片里的一个颜色特征' },
          { id: 'p2-label', text: '我们希望得到的类别标签' },
          { id: 'p2-camera', text: '拍摄图片的设备' },
        ],
        correctOptionId: 'p2-label',
      },
      {
        questionId: 'primary-q3',
        objectiveKey: 'classify-examples',
        prompt: '遇到一张从没见过的新图片，比较可靠的分类方法是什么？',
        options: [
          { id: 'p3-rule', text: '按照学到的共同特征判断' },
          { id: 'p3-guess', text: '每次都随机猜一个类别' },
          { id: 'p3-order', text: '只看图片出现的顺序' },
        ],
        correctOptionId: 'p3-rule',
      },
      {
        questionId: 'primary-q4',
        objectiveKey: 'uncertain-cases',
        prompt: '图片很模糊、看不清关键特征时，最诚实的做法是什么？',
        options: [
          { id: 'p4-certain', text: '假装一定知道答案' },
          { id: 'p4-uncertain', text: '说明不确定并请求更清楚的信息' },
          { id: 'p4-hide', text: '隐藏这张图片' },
        ],
        correctOptionId: 'p4-uncertain',
      },
    ],
  },
} satisfies Omit<StudyCourseDefinition, 'gradeBand'>;

export const legacyPrimaryLowImageAiCourse: StudyCourseDefinition = {
  ...legacyPrimaryImageAiCourse,
  gradeBand: 'primary_low',
};

export const legacyPrimaryHighImageAiCourse: StudyCourseDefinition = {
  ...legacyPrimaryImageAiCourse,
  gradeBand: 'primary_high',
};

export const primaryLowImageAiCourse: StudyCourseDefinition = {
  ...legacyPrimaryImageAiCourse,
  courseSlug: 'image-ai-primary-low',
  gradeBand: 'primary_low',
};

export const primaryLowImageAiArtifact = {
  schemaVersion: '1',
  artifactId: 'image-ai-primary-low-features-v1',
  type: 'classification_game',
  title: '特征和标签分类游戏',
  params: {
    prompt: '把可以直接观察到的“特征”和最终使用的“标签”分开放好',
    categories: [
      { id: 'feature', label: '可见特征' },
      { id: 'label', label: '类别标签' },
    ],
    items: [
      {
        id: 'pointed-ears',
        label: '尖尖的耳朵',
        emoji: '👂',
        correctCategoryId: 'feature',
      },
      {
        id: 'orange-fur',
        label: '橘色的毛',
        emoji: '🎨',
        correctCategoryId: 'feature',
      },
      {
        id: 'cat-label',
        label: '猫',
        emoji: '🐱',
        correctCategoryId: 'label',
      },
      {
        id: 'dog-label',
        label: '狗',
        emoji: '🐶',
        correctCategoryId: 'label',
      },
    ],
    successMessage: '分对了！特征是观察到的线索，标签是最后给出的类别名称。',
  },
} satisfies Artifact;

export const primaryHighImageAiCourse = {
  courseSlug: 'image-ai-primary-high',
  version: 'v1',
  gradeBand: 'primary_high',
  title: '图像 AI 与训练样例',
  objectives: [
    {
      objectiveKey: 'features-and-labels',
      knowledgeNodeId: 'image-ai-primary-high.features-and-labels',
      title: '区分特征与标签',
      description: '用可观察线索描述图片，并把类别名称与线索分开。',
      sequence: 1,
      prerequisiteObjectiveKeys: [],
    },
    {
      objectiveKey: 'training-examples',
      knowledgeNodeId: 'image-ai-primary-high.training-examples',
      title: '认识训练样例',
      description: '理解模型从许多带标签的例子中寻找共同规律。',
      sequence: 2,
      prerequisiteObjectiveKeys: ['features-and-labels'],
    },
    {
      objectiveKey: 'new-examples',
      knowledgeNodeId: 'image-ai-primary-high.new-examples',
      title: '判断新样例',
      description: '使用学到的规律判断没有见过的新图片。',
      sequence: 3,
      prerequisiteObjectiveKeys: ['training-examples'],
    },
    {
      objectiveKey: 'balanced-data',
      knowledgeNodeId: 'image-ai-primary-high.balanced-data',
      title: '保持样例多样',
      description: '理解类别、角度和场景单一会让模型学到偏颇规律。',
      sequence: 4,
      prerequisiteObjectiveKeys: ['training-examples'],
    },
    {
      objectiveKey: 'uncertain-predictions',
      knowledgeNodeId: 'image-ai-primary-high.uncertain-predictions',
      title: '识别不确定判断',
      description: '在线索不足时保留不确定性并请求更清楚的信息。',
      sequence: 5,
      prerequisiteObjectiveKeys: ['new-examples'],
    },
    {
      objectiveKey: 'human-review',
      knowledgeNodeId: 'image-ai-primary-high.human-review',
      title: '理解人工复核',
      description: '知道重要判断需要人检查，模型结果不能自动当作事实。',
      sequence: 6,
      prerequisiteObjectiveKeys: ['balanced-data', 'uncertain-predictions'],
    },
  ],
  diagnostic: {
    version: 'v1',
    questions: [
      {
        questionId: 'primary-high-q1',
        objectiveKey: 'features-and-labels',
        prompt: '“耳朵是三角形”在图片分类任务中更接近什么？',
        options: [
          { id: 'ph1-feature', text: '可以观察到的特征' },
          { id: 'ph1-label', text: '最终类别标签' },
          { id: 'ph1-result', text: '模型一定正确的证明' },
        ],
        correctOptionId: 'ph1-feature',
      },
      {
        questionId: 'primary-high-q2',
        objectiveKey: 'training-examples',
        prompt: '为什么训练图像通常需要带有正确标签？',
        options: [
          { id: 'ph2-learn', text: '帮助模型比较输入与目标类别' },
          { id: 'ph2-pretty', text: '让图片看起来更漂亮' },
          { id: 'ph2-smaller', text: '让图片文件自动变小' },
        ],
        correctOptionId: 'ph2-learn',
      },
      {
        questionId: 'primary-high-q3',
        objectiveKey: 'balanced-data',
        prompt: '训练“猫和狗”分类器时只放很多猫图，会有什么风险？',
        options: [
          { id: 'ph3-bias', text: '模型可能更容易把新图片都判断成猫' },
          { id: 'ph3-perfect', text: '模型会自动学会所有狗的特征' },
          { id: 'ph3-none', text: '样例多少完全没有影响' },
        ],
        correctOptionId: 'ph3-bias',
      },
      {
        questionId: 'primary-high-q4',
        objectiveKey: 'human-review',
        prompt: '模型对一张模糊图片给出结果后，重要场景中还应该怎么做？',
        options: [
          { id: 'ph4-review', text: '由人结合更多信息复核' },
          { id: 'ph4-trust', text: '无条件相信第一次结果' },
          { id: 'ph4-hide', text: '删除所有不确定图片' },
        ],
        correctOptionId: 'ph4-review',
      },
    ],
  },
} satisfies StudyCourseDefinition;

export const primaryHighImageAiArtifact = {
  schemaVersion: '1',
  artifactId: 'image-ai-primary-high-samples-v1',
  type: 'quiz',
  title: '训练样例小测验',
  params: {
    questions: [
      {
        id: 'sample-balance',
        question: '准备猫狗分类训练集时，下面哪组样例更合理？',
        options: [
          { id: 'balanced', text: '猫狗数量接近，并包含不同角度和环境' },
          { id: 'cats-only', text: '只收集同一角度的猫图片' },
          { id: 'names-only', text: '不看图片，只比较文件名长度' },
        ],
        correctOptionId: 'balanced',
        explanation: '类别和场景更均衡，模型才更有机会学到可泛化的规律。',
      },
      {
        id: 'uncertain-input',
        question: '图片非常模糊、关键特征看不清时，最合适的处理是什么？',
        options: [
          { id: 'ask', text: '说明不确定并请求更清楚的图片' },
          { id: 'pretend', text: '假装结果一定正确' },
          { id: 'random', text: '随机选择一个类别' },
        ],
        correctOptionId: 'ask',
        explanation: '线索不足时保留不确定性，比制造一个确定答案更可靠。',
      },
    ],
  },
} satisfies Artifact;
