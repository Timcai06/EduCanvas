import type { StudyCourseDefinition } from '@educanvas/teaching-core';

export const primaryImageAiCourse = {
  courseSlug: 'image-ai-primary',
  version: 'v1',
  gradeBand: 'primary_school',
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
} satisfies StudyCourseDefinition;
