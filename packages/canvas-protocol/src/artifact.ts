/**
 * Canvas Artifact — 受控内容白名单（ADR-0002）。
 *
 * ## 核心原则
 *
 * 模型输出结构化 Artifact → 白名单 Schema 校验 → 预注册 React 组件渲染。
 * **绝不执行模型生成的任意 HTML/JS/GSAP 源码**。
 *
 * 这不是"让模型控制 UI"的通道 — 这是"模型填空、渲染器负责展示"的数据契约。
 * 模型决定题目内容、选项、答案，但颜色、动画、布局完全由前端渲染器控制。
 *
 * ## Gredable vs Render-only
 *
 * | 类型 | 分类 | 说明 |
 * |------|------|------|
 * | quiz | gradable | 单选题，有正确答案，可判分 |
 * | classification_game | gradable | 分类拖拽，有正确答案，可判分 |
 * | pipeline_flow | render-only | 流程动画模板，只渲染不判分，无 GradingKey |
 *
 * ## 加入新类型检查清单
 *
 * 1. 在 `artifacts/` 中定义 paramsSchema
 * 2. 在 `artifactSchema` 判别联合中注册
 * 3. 如果是 gradable：同时注册到 `gradableArtifactSchema`
 * 4. 在 `public-artifact.ts` 中定义公开投影（剥离答案字段）
 * 5. 在 `grading.ts` 中定义 GradingKey 和判分逻辑
 * 6. 在 `canvas-registry.tsx` 中注册 React Renderer
 */

import { z } from 'zod';
import { classificationGameParamsSchema } from './artifacts/classification-game';
import { quizParamsSchema } from './artifacts/quiz';
import { pipelineFlowParamsSchema } from './artifacts/pipeline-flow';

/**
 * 协议版本随Artifact持久化，为未来兼容路由保留依据；当前只注册v1校验器。
 * 版本升级规则见 docs/09-decisions/0002-controlled-canvas.md。
 */
export const ARTIFACT_SCHEMA_VERSION = '1' as const;

/**
 * 所有 Artifact 共用可追踪标识与短标题；标题限制 80 字符是为了适配 Canvas 顶栏和窄屏，
 * 避免模型把正文塞进标题。具体教学内容必须进入各类型的 `params`。
 */
const artifactBaseSchema = z.object({
  schemaVersion: z.literal(ARTIFACT_SCHEMA_VERSION),
  artifactId: z.string().min(1),
  title: z.string().min(1).max(80),
});

/**
 * Canvas 只接受白名单联合中的类型；判别联合让 `type` 同时决定参数结构和预注册渲染器。
 * 每个分支使用 strict 模式，防止未评审字段穿透到 UI，见 ADR-0002。
 */
const classificationGameArtifactSchema = artifactBaseSchema
  .extend({
    type: z.literal('classification_game'),
    params: classificationGameParamsSchema,
  })
  .strict();

const quizArtifactSchema = artifactBaseSchema
  .extend({
    type: z.literal('quiz'),
    params: quizParamsSchema,
  })
  .strict();

const pipelineFlowArtifactSchema = artifactBaseSchema
  .extend({
    type: z.literal('pipeline_flow'),
    params: pipelineFlowParamsSchema,
  })
  .strict();

/** 可判分的 Artifact 子集 — quiz + classification_game。pipeline_flow 不在此列。 */
export const gradableArtifactSchema = z.discriminatedUnion('type', [
  classificationGameArtifactSchema,
  quizArtifactSchema,
]);

/** 所有可渲染的 Artifact 联合 — 包含 render-only 类型（pipeline_flow）。 */
export const artifactSchema = z.discriminatedUnion('type', [
  classificationGameArtifactSchema,
  quizArtifactSchema,
  pipelineFlowArtifactSchema,
]);

/** 经过白名单校验、可以安全交给 Canvas 注册表分派的 Artifact。 */
export type Artifact = z.infer<typeof artifactSchema>;
export type GradableArtifact = z.infer<typeof gradableArtifactSchema>;

/** 注册表允许实现的 Artifact 类型集合，始终从协议联合推导以避免双份清单漂移。 */
export type ArtifactType = Artifact['type'];

/**
 * 校验边界使用显式判别结果，调用方必须处理失败分支，不能用异常或类型断言跳过协议检查。
 */
export type ArtifactValidation =
  { ok: true; artifact: Artifact } | { ok: false; errors: string[] };

/**
 * 在模型输出进入渲染层前执行完整服务端Artifact的规范白名单校验，并把 Zod 问题收敛成可展示、可记录的路径消息。
 * 调用方不得在失败时降级执行原始内容，安全边界见 docs/09-decisions/0002-controlled-canvas.md。
 */
export function validateArtifact(input: unknown): ArtifactValidation {
  const result = artifactSchema.safeParse(input);
  if (result.success) {
    return { ok: true, artifact: result.data };
  }
  return {
    ok: false,
    errors: result.error.issues.map(
      (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
    ),
  };
}
