import { z } from 'zod';
import { classificationGameParamsSchema } from './artifacts/classification-game';
import { quizParamsSchema } from './artifacts/quiz';

// 受控 Canvas 协议（ADR-0002）：模型输出结构化 Artifact，经此白名单 Schema
// 校验后由预注册 React 组件渲染。绝不执行模型生成的任意 HTML/JS/GSAP 源码。
//
// docs/02-architecture/canvas-and-gsap.md 规划了 10 种 Artifact 类型，
// 阶段一先实现 classification_game 和 quiz，其余类型随组件逐个加入本联合。

/**
 * 协议版本必须随 Artifact 持久化，便于旧会话回放时选择兼容的校验与渲染逻辑。
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

/** 经过白名单校验、可以安全交给 Canvas 注册表分派的 Artifact。 */
export type Artifact = z.infer<typeof artifactSchema>;

/** 注册表允许实现的 Artifact 类型集合，始终从协议联合推导以避免双份清单漂移。 */
export type ArtifactType = Artifact['type'];

/**
 * 校验边界使用显式判别结果，调用方必须处理失败分支，不能用异常或类型断言跳过协议检查。
 */
export type ArtifactValidation =
  { ok: true; artifact: Artifact } | { ok: false; errors: string[] };

/**
 * 在模型输出进入渲染层前执行唯一的白名单校验，并把 Zod 问题收敛成可展示、可记录的路径消息。
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
