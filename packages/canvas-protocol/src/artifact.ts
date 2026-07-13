import { z } from 'zod';
import { classificationGameParamsSchema } from './artifacts/classification-game';
import { quizParamsSchema } from './artifacts/quiz';

// 受控 Canvas 协议（ADR-0002）：模型输出结构化 Artifact，经此白名单 Schema
// 校验后由预注册 React 组件渲染。绝不执行模型生成的任意 HTML/JS/GSAP 源码。
//
// doc/02-architecture/canvas-and-gsap.md 规划了 10 种 Artifact 类型，
// 阶段一先实现 classification_game 和 quiz，其余类型随组件逐个加入本联合。

export const ARTIFACT_SCHEMA_VERSION = '1' as const;

const artifactBaseSchema = z.object({
  schemaVersion: z.literal(ARTIFACT_SCHEMA_VERSION),
  artifactId: z.string().min(1),
  title: z.string().min(1).max(80),
});

export const artifactSchema = z.discriminatedUnion('type', [
  artifactBaseSchema
    .extend({
      type: z.literal('classification_game'),
      params: classificationGameParamsSchema,
    })
    .strict(),
  artifactBaseSchema
    .extend({
      type: z.literal('quiz'),
      params: quizParamsSchema,
    })
    .strict(),
]);

export type Artifact = z.infer<typeof artifactSchema>;
export type ArtifactType = Artifact['type'];

export type ArtifactValidation =
  | { ok: true; artifact: Artifact }
  | { ok: false; errors: string[] };

/** 校验模型输出。任何未通过白名单 Schema 的内容都不进入渲染层。 */
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
