import type { PublicArtifact } from '@educanvas/canvas-protocol';

/** Fixed fixture for the gated design-QA route; never accepts user/model code. */
export const pipelineFlowQaArtifact = {
  schemaVersion: '1',
  // Deliberate whitespace edge case: Renderer accessibility IDs must not reuse
  // model-owned artifact IDs.
  artifactId: 'design qa pipeline flow',
  type: 'pipeline_flow',
  title: '图像如何被模型认出来',
  params: {
    templateKey: 'pipeline_flow',
    objective: '跟随模型，把一张动物图片变成可信的分类结果',
    steps: [
      {
        slot: 'input',
        label: '接收图片',
        narration: '像素矩阵进入模型，保留图片中的颜色与空间信息。',
      },
      {
        slot: 'feature_extraction',
        label: '提取视觉特征',
        narration: '模型逐层寻找边缘、纹理、耳朵形状等可区分线索。',
      },
      {
        slot: 'classification',
        label: '比较类别证据',
        narration: '将提取到的特征与学到的模式比较，形成各类别分数。',
      },
      {
        slot: 'output',
        label: '输出预测',
        narration: '展示分数最高的类别，同时保留结果可能出错的提醒。',
      },
    ],
    highlightOrder: [
      'input',
      'feature_extraction',
      'classification',
      'output',
    ],
    pausePoints: ['feature_extraction', 'classification'],
    completionMessage: '动画播放完成不等于掌握；请回到对话解释每一步。',
  },
} as const satisfies PublicArtifact;
