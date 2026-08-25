import 'server-only';

import type { Artifact } from '@educanvas/canvas-protocol/server';
import type { StudyCourseDefinition } from '@educanvas/teaching-core';

export const primaryLowAiSafetyCourse = {
  courseSlug: 'ai-safety-primary-low',
  version: 'v1',
  gradeBand: 'primary_low',
  title: '和 AI 说话也要保护自己',
  objectives: [
    {
      objectiveKey: 'recognize-personal-info',
      knowledgeNodeId: 'ai-safety-primary-low.recognize-personal-info',
      title: '认出个人信息',
      description: '知道姓名、住址、学校和联系方式属于需要保护的信息。',
      sequence: 1,
      prerequisiteObjectiveKeys: [],
    },
    {
      objectiveKey: 'safe-prompts',
      knowledgeNodeId: 'ai-safety-primary-low.safe-prompts',
      title: '提出安全问题',
      description: '在不透露个人信息的情况下把问题说明白。',
      sequence: 2,
      prerequisiteObjectiveKeys: ['recognize-personal-info'],
    },
    {
      objectiveKey: 'ai-can-be-wrong',
      knowledgeNodeId: 'ai-safety-primary-low.ai-can-be-wrong',
      title: '知道 AI 也会答错',
      description: '把 AI 的回答当作建议，而不是自动当作事实。',
      sequence: 3,
      prerequisiteObjectiveKeys: ['safe-prompts'],
    },
    {
      objectiveKey: 'check-with-sources',
      knowledgeNodeId: 'ai-safety-primary-low.check-with-sources',
      title: '用可靠来源核对',
      description: '通过课本、老师或可信网站检查重要信息。',
      sequence: 4,
      prerequisiteObjectiveKeys: ['ai-can-be-wrong'],
    },
    {
      objectiveKey: 'ask-an-adult',
      knowledgeNodeId: 'ai-safety-primary-low.ask-an-adult',
      title: '遇到风险找成年人',
      description: '遇到索要隐私、付费或令人不安的内容时停止并求助。',
      sequence: 5,
      prerequisiteObjectiveKeys: ['recognize-personal-info'],
    },
    {
      objectiveKey: 'responsible-use',
      knowledgeNodeId: 'ai-safety-primary-low.responsible-use',
      title: '负责任地使用 AI',
      description: '不让 AI 代替自己的思考，也不利用它伤害或欺骗别人。',
      sequence: 6,
      prerequisiteObjectiveKeys: ['check-with-sources', 'ask-an-adult'],
    },
  ],
  diagnostic: {
    version: 'v1',
    questions: [
      {
        questionId: 'safety-low-q1',
        objectiveKey: 'recognize-personal-info',
        prompt: '下面哪项不适合直接告诉陌生的 AI 服务？',
        options: [
          { id: 'sl1-address', text: '家庭详细住址' },
          { id: 'sl1-topic', text: '我想了解恐龙' },
          { id: 'sl1-color', text: '我喜欢蓝色' },
        ],
        correctOptionId: 'sl1-address',
      },
      {
        questionId: 'safety-low-q2',
        objectiveKey: 'ai-can-be-wrong',
        prompt: 'AI 很肯定地说了一件事，最稳妥的做法是什么？',
        options: [
          { id: 'sl2-check', text: '用可靠来源再核对' },
          { id: 'sl2-trust', text: '因为语气肯定就完全相信' },
          { id: 'sl2-share', text: '立刻转发给所有同学' },
        ],
        correctOptionId: 'sl2-check',
      },
      {
        questionId: 'safety-low-q3',
        objectiveKey: 'ask-an-adult',
        prompt: '聊天工具要求输入家长银行卡信息时应该怎么办？',
        options: [
          { id: 'sl3-stop', text: '停止操作并告诉可信成年人' },
          { id: 'sl3-enter', text: '照着输入以便继续聊天' },
          { id: 'sl3-guess', text: '随便猜一串号码' },
        ],
        correctOptionId: 'sl3-stop',
      },
    ],
  },
} satisfies StudyCourseDefinition;

export const primaryLowAiSafetyArtifact = {
  schemaVersion: '1',
  artifactId: 'ai-safety-primary-low-v1',
  type: 'classification_game',
  title: '哪些信息可以分享？',
  params: {
    prompt: '把信息放进“可以用于提问”或“需要保护”',
    categories: [
      { id: 'safe', label: '可以用于提问' },
      { id: 'private', label: '需要保护' },
    ],
    items: [
      {
        id: 'topic',
        label: '我想了解太阳系',
        emoji: '🪐',
        correctCategoryId: 'safe',
      },
      {
        id: 'home',
        label: '家庭详细住址',
        emoji: '🏠',
        correctCategoryId: 'private',
      },
      {
        id: 'school-card',
        label: '学生证照片',
        emoji: '🪪',
        correctCategoryId: 'private',
      },
      {
        id: 'math',
        label: '一道不会的数学题',
        emoji: '➗',
        correctCategoryId: 'safe',
      },
    ],
    successMessage: '做得好：说清学习问题，不必交出能识别你身份的信息。',
  },
} satisfies Artifact;

export const primaryHighRecommendationCourse = {
  courseSlug: 'recommendation-ai-primary-high',
  version: 'v1',
  gradeBand: 'primary_high',
  title: '推荐列表为什么懂我',
  objectives: [
    {
      objectiveKey: 'interaction-data',
      knowledgeNodeId: 'recommendation-ai-primary-high.interaction-data',
      title: '认识互动数据',
      description: '理解点击、停留和跳过会成为推荐系统的观察信号。',
      sequence: 1,
      prerequisiteObjectiveKeys: [],
    },
    {
      objectiveKey: 'find-patterns',
      knowledgeNodeId: 'recommendation-ai-primary-high.find-patterns',
      title: '从数据寻找规律',
      description: '理解系统会比较相似内容和相似用户的选择。',
      sequence: 2,
      prerequisiteObjectiveKeys: ['interaction-data'],
    },
    {
      objectiveKey: 'predict-interest',
      knowledgeNodeId: 'recommendation-ai-primary-high.predict-interest',
      title: '预测可能的兴趣',
      description: '知道推荐是概率判断，不代表用户一定喜欢。',
      sequence: 3,
      prerequisiteObjectiveKeys: ['find-patterns'],
    },
    {
      objectiveKey: 'feedback-loop',
      knowledgeNodeId: 'recommendation-ai-primary-high.feedback-loop',
      title: '发现反馈循环',
      description: '理解越常点击某类内容，系统越可能继续推荐同类内容。',
      sequence: 4,
      prerequisiteObjectiveKeys: ['predict-interest'],
    },
    {
      objectiveKey: 'missing-viewpoints',
      knowledgeNodeId: 'recommendation-ai-primary-high.missing-viewpoints',
      title: '注意视野变窄',
      description: '认识重复推荐可能让人较少看到不同主题和观点。',
      sequence: 5,
      prerequisiteObjectiveKeys: ['feedback-loop'],
    },
    {
      objectiveKey: 'control-recommendations',
      knowledgeNodeId: 'recommendation-ai-primary-high.control-recommendations',
      title: '主动管理推荐',
      description: '会使用不感兴趣、清除记录和主动搜索来调整信息环境。',
      sequence: 6,
      prerequisiteObjectiveKeys: ['missing-viewpoints'],
    },
  ],
  diagnostic: {
    version: 'v1',
    questions: [
      {
        questionId: 'recommend-high-q1',
        objectiveKey: 'interaction-data',
        prompt: '下面哪项最可能成为短视频推荐系统的信号？',
        options: [
          { id: 'rh1-watch', text: '看完并点赞某类视频' },
          { id: 'rh1-weather', text: '窗外今天是否下雨' },
          { id: 'rh1-paper', text: '作业本用了什么颜色' },
        ],
        correctOptionId: 'rh1-watch',
      },
      {
        questionId: 'recommend-high-q2',
        objectiveKey: 'predict-interest',
        prompt: '系统推荐了一首歌，说明什么？',
        options: [
          { id: 'rh2-likely', text: '系统预测你可能感兴趣' },
          { id: 'rh2-certain', text: '系统证明你一定喜欢' },
          { id: 'rh2-best', text: '这一定是世界上最好的歌' },
        ],
        correctOptionId: 'rh2-likely',
      },
      {
        questionId: 'recommend-high-q3',
        objectiveKey: 'control-recommendations',
        prompt: '想减少重复推荐同一主题，可以怎样做？',
        options: [
          { id: 'rh3-control', text: '标记不感兴趣并主动搜索其他主题' },
          { id: 'rh3-repeat', text: '继续反复点击同类内容' },
          { id: 'rh3-believe', text: '认为推荐列表无法改变' },
        ],
        correctOptionId: 'rh3-control',
      },
    ],
  },
} satisfies StudyCourseDefinition;

export const primaryHighRecommendationArtifact = {
  schemaVersion: '1',
  artifactId: 'recommendation-ai-primary-high-v1',
  type: 'quiz',
  title: '推荐系统观察站',
  params: {
    questions: [
      {
        id: 'signal',
        question: '连续看完多个篮球视频后，推荐列表最可能怎样变化？',
        options: [
          { id: 'more', text: '出现更多相似篮球内容' },
          { id: 'none', text: '互动不会影响任何推荐' },
          { id: 'certain', text: '系统立刻知道你的全部兴趣' },
        ],
        correctOptionId: 'more',
        explanation: '互动是推荐信号，但只反映局部行为，不能代表你的全部兴趣。',
      },
      {
        id: 'loop',
        question: '为什么推荐列表可能让信息视野变窄？',
        options: [
          { id: 'repeat', text: '相似互动和相似推荐会互相加强' },
          { id: 'screen', text: '屏幕尺寸限制了内容种类' },
          { id: 'perfect', text: '系统总能展示所有不同观点' },
        ],
        correctOptionId: 'repeat',
        explanation: '反馈循环会不断强化已经出现的偏好信号。',
      },
      {
        id: 'control',
        question: '下面哪种做法更能主动管理推荐？',
        options: [
          { id: 'diversify', text: '主动搜索不同主题并调整推荐偏好' },
          { id: 'passive', text: '只接受系统给出的第一条内容' },
          { id: 'share', text: '公开所有个人账号信息' },
        ],
        correctOptionId: 'diversify',
        explanation: '主动给出多样信号并使用控制功能，可以改善信息环境。',
      },
    ],
  },
} satisfies Artifact;
