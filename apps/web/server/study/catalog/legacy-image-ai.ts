import 'server-only';

import type { Artifact } from '@educanvas/canvas-protocol/server';

/** 兼容 2026-08-25 前已持久化 Notebook；新计划不得再选择这份通用练习。 */
export const legacyImageAiArtifact = {
  schemaVersion: '1',
  artifactId: 'demo-cat-dog',
  type: 'classification_game',
  title: '猫和狗的分类游戏',
  params: {
    prompt: '把下面的动物拖到正确的类别里',
    categories: [
      { id: 'cat', label: '猫' },
      { id: 'dog', label: '狗' },
    ],
    items: [
      { id: 'i1', label: '橘猫', emoji: '🐱', correctCategoryId: 'cat' },
      { id: 'i2', label: '柴犬', emoji: '🐶', correctCategoryId: 'dog' },
    ],
    successMessage: '全部分类正确！你已经理解了这个基础分类任务。',
  },
} satisfies Artifact;
