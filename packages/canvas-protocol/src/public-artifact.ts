import { z } from 'zod';
import { ARTIFACT_SCHEMA_VERSION } from './artifact';

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
]);

/** 已剥离答案、可以跨越服务端到浏览器边界的Artifact。 */
export type PublicArtifact = z.infer<typeof publicArtifactSchema>;

/** 浏览器注册表允许实现的Artifact类型闭集。 */
export type PublicArtifactType = PublicArtifact['type'];

/** 在客户端渲染前再次执行公开协议校验，未知字段不会被静默传入组件。 */
export function validatePublicArtifact(input: unknown) {
  return publicArtifactSchema.safeParse(input);
}
