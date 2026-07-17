import 'server-only';

/** 阶段一纵切的受信课程配置；浏览器不能覆盖这些教学身份字段或完整Artifact。 */
export const demoLesson = {
  gradeBand: 'primary_school',
  courseSlug: 'cat-dog-ai',
  courseTitle: '图像是怎么被认出来的',
  knowledgeNodeId: 'cat-dog-classification',
  artifact: {
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
  },
} as const;
