/**
 * 公开 Artifact — 浏览器安全的 Artifact 投影。
 *
 * ## 为什么需要公开/私有分离
 *
 * 完整的 Artifact（如 quiz）包含正确答案（correctOptionId）和解析（explanation）。
 * 如果直接发给浏览器，学生打开 DevTools 就能看到答案。
 *
 * 解决方案：
 * - **Artifact** → 保留在服务端，包含完整信息（题目+答案）
 * - **PublicArtifact** → 发给浏览器，剥离答案相关内容
 * - **GradingKey** → 保留在服务端，用于对学生提交做判分
 *
 * ## Schema 安全设计
 *
 * PublicArtifact 的每个字段都经过审查：
 * - 不包含 correctOptionId、explanation、correctCategoryId 等答案字段
 * - strict 模式拒绝未评审的额外字段
 * - 渲染前再用 validatePublicArtifact 校验一次，防协议版本不匹配
 */

import { z } from 'zod';
import { ARTIFACT_SCHEMA_VERSION } from './artifact';
import { pipelineFlowParamsSchema } from './artifacts/pipeline-flow';

const publicArtifactBaseSchema = z.object({
  schemaVersion: z.literal(ARTIFACT_SCHEMA_VERSION),
  artifactId: z.string().min(1).max(128),
  title: z.string().min(1).max(80),
});

/** 浏览器可见的分类项目；正确类别只能保存在服务端判分键中。 */
export const publicClassificationItemSchema = z
  .object({
    id: z.string().min(1).max(128),
    label: z.string().min(1).max(20),
    emoji: z.string().min(1).max(8),
  })
  .strict();

/** 浏览器可见的单选题；不包含正确选项和答案解析。 */
export const publicQuizQuestionSchema = z
  .object({
    id: z.string().min(1).max(128),
    question: z.string().min(1).max(300),
    options: z
      .array(
        z
          .object({
            id: z.string().min(1).max(128),
            text: z.string().min(1).max(120),
          })
          .strict(),
      )
      .min(2)
      .max(5),
  })
  .strict();

/** Canvas客户端唯一允许接收的Artifact联合，结构上排除全部私有判分信息。 */
export const publicArtifactSchema = z.discriminatedUnion('type', [
  publicArtifactBaseSchema
    .extend({
      type: z.literal('classification_game'),
      params: z
        .object({
          prompt: z.string().min(1).max(200),
          categories: z
            .array(
              z
                .object({
                  id: z.string().min(1).max(128),
                  label: z.string().min(1).max(20),
                })
                .strict(),
            )
            .min(2)
            .max(4),
          items: z.array(publicClassificationItemSchema).min(2).max(12),
        })
        .strict(),
    })
    .strict(),
  publicArtifactBaseSchema
    .extend({
      type: z.literal('quiz'),
      params: z
        .object({
          questions: z.array(publicQuizQuestionSchema).min(1).max(10),
        })
        .strict(),
    })
    .strict(),
  publicArtifactBaseSchema
    .extend({
      type: z.literal('pipeline_flow'),
      params: pipelineFlowParamsSchema,
    })
    .strict(),
]);

/** 已剥离答案、可以跨越服务端到浏览器边界的Artifact。 */
export type PublicArtifact = z.infer<typeof publicArtifactSchema>;

/** 浏览器注册表允许实现的Artifact类型闭集。 */
export type PublicArtifactType = PublicArtifact['type'];

/** 在客户端渲染前再次执行公开协议校验，未知字段不会被静默传入组件。 */
export function validatePublicArtifact(input: unknown) {
  return publicArtifactSchema.safeParse(input);
}
