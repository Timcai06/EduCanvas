import 'server-only';

import type { Artifact } from '@educanvas/canvas-protocol/server';
import type { StudyCourseDefinition } from '@educanvas/teaching-core';

export const middleRecommendationCourse = {
  courseSlug: 'recommendation-ai-middle',
  version: 'v1',
  gradeBand: 'middle_school',
  title: '推荐算法与反馈循环',
  objectives: [
    {
      objectiveKey: 'behavior-signals',
      knowledgeNodeId: 'recommendation-ai-middle.behavior-signals',
      title: '区分显式与隐式反馈',
      description: '区分评分、点赞等显式反馈和点击、停留等隐式行为信号。',
      sequence: 1,
      prerequisiteObjectiveKeys: [],
    },
    {
      objectiveKey: 'similarity',
      knowledgeNodeId: 'recommendation-ai-middle.similarity',
      title: '理解相似度推荐',
      description: '解释基于内容相似或用户行为相似产生推荐的基本思路。',
      sequence: 2,
      prerequisiteObjectiveKeys: ['behavior-signals'],
    },
    {
      objectiveKey: 'ranking-score',
      knowledgeNodeId: 'recommendation-ai-middle.ranking-score',
      title: '认识排序分数',
      description: '理解候选内容会根据多个信号计算分数并排序。',
      sequence: 3,
      prerequisiteObjectiveKeys: ['similarity'],
    },
    {
      objectiveKey: 'feedback-loop',
      knowledgeNodeId: 'recommendation-ai-middle.feedback-loop',
      title: '分析反馈循环',
      description: '说明曝光、互动和再次推荐如何形成自我强化循环。',
      sequence: 4,
      prerequisiteObjectiveKeys: ['ranking-score'],
    },
    {
      objectiveKey: 'bias-and-diversity',
      knowledgeNodeId: 'recommendation-ai-middle.bias-and-diversity',
      title: '评估偏差与多样性',
      description: '分析热门偏置和单一兴趣标签怎样压缩内容多样性。',
      sequence: 5,
      prerequisiteObjectiveKeys: ['feedback-loop'],
    },
    {
      objectiveKey: 'responsible-design',
      knowledgeNodeId: 'recommendation-ai-middle.responsible-design',
      title: '设计负责任的推荐',
      description: '比较准确率、多样性、用户控制和隐私之间的权衡。',
      sequence: 6,
      prerequisiteObjectiveKeys: ['bias-and-diversity'],
    },
  ],
  diagnostic: {
    version: 'v1',
    questions: [
      {
        questionId: 'recommend-middle-q1',
        objectiveKey: 'behavior-signals',
        prompt: '“用户给电影打 5 分”属于哪类信号？',
        options: [
          { id: 'rm1-explicit', text: '显式反馈' },
          { id: 'rm1-implicit', text: '隐式反馈' },
          { id: 'rm1-random', text: '随机噪声' },
        ],
        correctOptionId: 'rm1-explicit',
      },
      {
        questionId: 'recommend-middle-q2',
        objectiveKey: 'feedback-loop',
        prompt: '推荐系统中的反馈循环通常怎样形成？',
        options: [
          { id: 'rm2-loop', text: '曝光影响互动，互动又影响下一次曝光' },
          { id: 'rm2-static', text: '推荐永远与用户行为无关' },
          { id: 'rm2-delete', text: '每次互动都会删除历史数据' },
        ],
        correctOptionId: 'rm2-loop',
      },
      {
        questionId: 'recommend-middle-q3',
        objectiveKey: 'responsible-design',
        prompt: '只追求点击率可能忽略什么？',
        options: [
          { id: 'rm3-balance', text: '内容多样性、用户控制和长期影响' },
          { id: 'rm3-resolution', text: '屏幕的物理分辨率' },
          { id: 'rm3-keyboard', text: '键盘按键数量' },
        ],
        correctOptionId: 'rm3-balance',
      },
    ],
  },
} satisfies StudyCourseDefinition;

export const middleRecommendationArtifact = {
  schemaVersion: '1',
  artifactId: 'recommendation-ai-middle-v1',
  type: 'quiz',
  title: '推荐算法决策实验',
  params: {
    questions: [
      {
        id: 'signal-strength',
        question: '哪组行为通常能提供更清晰的兴趣信号？',
        options: [
          { id: 'repeated', text: '多次完整观看并主动收藏同类内容' },
          { id: 'single', text: '误触一次后立刻退出' },
          { id: 'unrelated', text: '设备电量发生变化' },
        ],
        correctOptionId: 'repeated',
        explanation: '重复且主动的互动通常比一次误触更能反映兴趣。',
      },
      {
        id: 'popularity-bias',
        question: '热门内容获得更多曝光，更多曝光又带来更多点击，这体现什么？',
        options: [
          { id: 'loop', text: '热门偏置的反馈循环' },
          { id: 'encryption', text: '数据加密' },
          { id: 'compression', text: '文件压缩' },
        ],
        correctOptionId: 'loop',
        explanation: '初始优势被持续曝光放大，冷门内容更难获得新反馈。',
      },
      {
        id: 'responsible',
        question: '更负责任的推荐设计应加入哪项能力？',
        options: [
          { id: 'controls', text: '多样性约束和清晰的用户控制' },
          { id: 'maximize', text: '只最大化短期停留时长' },
          { id: 'hide', text: '隐藏推荐原因和设置入口' },
        ],
        correctOptionId: 'controls',
        explanation: '多样性与用户控制能降低单一目标带来的长期风险。',
      },
    ],
  },
} satisfies Artifact;

export const highGenerativeAiCourse = {
  courseSlug: 'generative-ai-high',
  version: 'v1',
  gradeBand: 'high_school',
  title: '生成式 AI 与证据核验',
  objectives: [
    {
      objectiveKey: 'next-token-generation',
      knowledgeNodeId: 'generative-ai-high.next-token-generation',
      title: '理解概率生成',
      description: '用基于上下文预测后续 token 的视角理解语言模型输出。',
      sequence: 1,
      prerequisiteObjectiveKeys: [],
    },
    {
      objectiveKey: 'training-and-context',
      knowledgeNodeId: 'generative-ai-high.training-and-context',
      title: '区分训练知识与当前上下文',
      description: '区分参数中学习到的模式和本次输入提供的临时信息。',
      sequence: 2,
      prerequisiteObjectiveKeys: ['next-token-generation'],
    },
    {
      objectiveKey: 'hallucination',
      knowledgeNodeId: 'generative-ai-high.hallucination',
      title: '识别无依据生成',
      description: '理解流畅、具体和自信并不能证明陈述真实。',
      sequence: 3,
      prerequisiteObjectiveKeys: ['training-and-context'],
    },
    {
      objectiveKey: 'source-verification',
      knowledgeNodeId: 'generative-ai-high.source-verification',
      title: '核验来源与主张',
      description: '把回答拆成可核验主张，并回到原始或权威来源检查。',
      sequence: 4,
      prerequisiteObjectiveKeys: ['hallucination'],
    },
    {
      objectiveKey: 'retrieval-boundary',
      knowledgeNodeId: 'generative-ai-high.retrieval-boundary',
      title: '理解检索增强边界',
      description: '解释检索怎样提供证据，以及错误检索为何仍会产生错误回答。',
      sequence: 5,
      prerequisiteObjectiveKeys: ['source-verification'],
    },
    {
      objectiveKey: 'responsible-workflow',
      knowledgeNodeId: 'generative-ai-high.responsible-workflow',
      title: '建立可靠使用流程',
      description: '根据风险选择人工复核、交叉验证和披露 AI 使用情况。',
      sequence: 6,
      prerequisiteObjectiveKeys: ['retrieval-boundary'],
    },
  ],
  diagnostic: {
    version: 'v1',
    questions: [
      {
        questionId: 'gen-high-q1',
        objectiveKey: 'next-token-generation',
        prompt: '语言模型生成回答时，最接近的描述是什么？',
        options: [
          {
            id: 'gh1-probability',
            text: '根据上下文对后续 token 进行概率预测',
          },
          { id: 'gh1-database', text: '逐字复制一个永远正确的答案数据库' },
          { id: 'gh1-human', text: '像人一样亲自经历所有事件' },
        ],
        correctOptionId: 'gh1-probability',
      },
      {
        questionId: 'gen-high-q2',
        objectiveKey: 'hallucination',
        prompt: '为什么带有具体日期和引用格式的回答仍可能错误？',
        options: [
          { id: 'gh2-form', text: '语言形式逼真不等于事实有可靠依据' },
          { id: 'gh2-date', text: '只要有日期就一定正确' },
          { id: 'gh2-long', text: '回答越长就越可靠' },
        ],
        correctOptionId: 'gh2-form',
      },
      {
        questionId: 'gen-high-q3',
        objectiveKey: 'source-verification',
        prompt: '核验 AI 给出的统计数字时，应优先做什么？',
        options: [
          { id: 'gh3-source', text: '找到原始数据或权威发布并核对口径' },
          { id: 'gh3-repeat', text: '让同一个模型重复三次' },
          { id: 'gh3-style', text: '检查回答排版是否美观' },
        ],
        correctOptionId: 'gh3-source',
      },
    ],
  },
} satisfies StudyCourseDefinition;

export const highGenerativeAiArtifact = {
  schemaVersion: '1',
  artifactId: 'generative-ai-high-v1',
  type: 'quiz',
  title: 'AI 回答可信度检查',
  params: {
    questions: [
      {
        id: 'confidence',
        question: '模型用非常自信的语气回答，能直接推出什么？',
        options: [
          { id: 'nothing', text: '不能直接推出事实正确，仍需证据' },
          { id: 'true', text: '语气自信就证明内容真实' },
          { id: 'source', text: '模型一定查阅了权威来源' },
        ],
        correctOptionId: 'nothing',
        explanation: '语言风格是生成结果的一部分，不能替代可追溯证据。',
      },
      {
        id: 'retrieval',
        question: '检索增强后，回答仍可能出错的原因是什么？',
        options: [
          {
            id: 'bad-evidence',
            text: '可能检索到不相关或错误资料，也可能误读证据',
          },
          { id: 'perfect', text: '使用检索后不可能再犯错' },
          { id: 'network', text: '只有网速会影响事实正确性' },
        ],
        correctOptionId: 'bad-evidence',
        explanation: '检索提供上下文，但证据质量和推理过程仍需验证。',
      },
      {
        id: 'high-stakes',
        question: '在医疗、法律等高风险场景中，合理做法是什么？',
        options: [
          { id: 'review', text: '把 AI 当辅助并交由合格人员复核' },
          { id: 'automate', text: '不经复核直接执行所有建议' },
          { id: 'hide', text: '隐藏曾使用 AI 的事实' },
        ],
        correctOptionId: 'review',
        explanation: '风险越高，越需要可追溯证据、专业判断与明确责任。',
      },
    ],
  },
} satisfies Artifact;
