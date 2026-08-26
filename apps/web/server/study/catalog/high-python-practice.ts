import 'server-only';

import type { Artifact } from '@educanvas/canvas-protocol/server';
import type { StudyCourseDefinition } from '@educanvas/teaching-core';

export const highPythonPracticeCourse = {
  courseSlug: 'python-data-practice-high',
  version: 'v1',
  gradeBand: 'high_school',
  title: 'Python 数据与算法实践',
  objectives: [
    {
      objectiveKey: 'variables-and-values',
      knowledgeNodeId: 'python-data-practice-high.variables-and-values',
      title: '变量与表达式',
      description: '用变量保存数据，并用表达式完成可检查的计算。',
      sequence: 1,
      prerequisiteObjectiveKeys: [],
    },
    {
      objectiveKey: 'collections',
      knowledgeNodeId: 'python-data-practice-high.collections',
      title: '列表与数据集合',
      description: '使用列表组织一组数据，并理解元素与长度。',
      sequence: 2,
      prerequisiteObjectiveKeys: ['variables-and-values'],
    },
    {
      objectiveKey: 'aggregation',
      knowledgeNodeId: 'python-data-practice-high.aggregation',
      title: '汇总与平均值',
      description: '用求和、计数和除法计算数据的平均值。',
      sequence: 3,
      prerequisiteObjectiveKeys: ['collections'],
    },
    {
      objectiveKey: 'conditions',
      knowledgeNodeId: 'python-data-practice-high.conditions',
      title: '条件判断',
      description: '根据布尔条件让程序选择不同执行路径。',
      sequence: 4,
      prerequisiteObjectiveKeys: ['variables-and-values'],
    },
    {
      objectiveKey: 'loops',
      knowledgeNodeId: 'python-data-practice-high.loops',
      title: '循环处理',
      description: '使用循环逐项处理集合中的数据。',
      sequence: 5,
      prerequisiteObjectiveKeys: ['collections', 'conditions'],
    },
    {
      objectiveKey: 'debug-by-output',
      knowledgeNodeId: 'python-data-practice-high.debug-by-output',
      title: '根据输出调试',
      description: '运行程序、阅读输出和错误信息并修正关键代码。',
      sequence: 6,
      prerequisiteObjectiveKeys: ['aggregation', 'loops'],
    },
  ],
  diagnostic: {
    version: 'v1',
    questions: [
      {
        questionId: 'python-q1',
        objectiveKey: 'variables-and-values',
        prompt: '表达式 total = 3 + 4 执行后，total 的值是多少？',
        options: [
          { id: 'python-q1-7', text: '7' },
          { id: 'python-q1-34', text: '34' },
          { id: 'python-q1-total', text: 'total' },
        ],
        correctOptionId: 'python-q1-7',
      },
      {
        questionId: 'python-q2',
        objectiveKey: 'collections',
        prompt: 'len([72, 85, 91, 68]) 的结果是什么？',
        options: [
          { id: 'python-q2-4', text: '4' },
          { id: 'python-q2-68', text: '68' },
          { id: 'python-q2-316', text: '316' },
        ],
        correctOptionId: 'python-q2-4',
      },
      {
        questionId: 'python-q3',
        objectiveKey: 'debug-by-output',
        prompt: '程序没有得到预期结果时，第一步最适合做什么？',
        options: [
          { id: 'python-q3-read', text: '阅读输出和错误信息' },
          { id: 'python-q3-delete', text: '删除全部代码' },
          { id: 'python-q3-guess', text: '不运行直接猜答案' },
        ],
        correctOptionId: 'python-q3-read',
      },
    ],
  },
} satisfies StudyCourseDefinition;

export const highPythonPracticeArtifact = {
  schemaVersion: '1',
  artifactId: 'python-average-fill-v1',
  type: 'code_completion',
  title: '补全平均分计算',
  params: {
    language: 'python',
    prompt:
      '补全 average 这一行，计算 scores 中所有分数的平均值。运行代码检查输出，再提交答案。',
    starterCode:
      'scores = [72, 85, 91, 68]\n\n# 在下一行补全平均值计算\naverage = ___\n\nprint(f"{average:.1f}")\n',
    requiredLine: 'average = sum(scores) / len(scores)',
    expectedOutput: '79.0',
    successMessage: '你正确地用总和除以数据个数求出了平均值。',
  },
} satisfies Artifact;
