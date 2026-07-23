/**
 * Canvas 判分管线 — 服务端确定性评分。
 *
 * ## 公开/私有分离
 *
 * Artifact 在服务端被拆成两份：
 * - **PublicArtifact** → 发给浏览器，不包含正确答案。学生看到题目但不知道答案
 * - **GradingKey** → 留在服务端，包含正确答案。用于对学生提交做确定性判分
 *
 * 这个分离是安全边界 — 客户端永远拿不到 GradingKey，
 * 所以即使学生打开 DevTools 也看不到答案。
 *
 * ## 判分流程
 *
 * ```
 * 模型输出 Artifact → prepareArtifact() → { publicArtifact, gradingKey }
 *                                                │
 *                                   发到浏览器，存入 gradingKey 到 DB
 *                                                │
 * 学生提交 → CanvasInteractionEvent → gradeCanvasSubmission(gradingKey, event)
 *                                                │
 *                                   返回 GradingDecision → 可信 assessment_graded 事件
 * ```
 *
 * ## 判分拒绝 ≠ 答错
 *
 * 被拒绝的提交（ARTIFACT_MISMATCH、UNKNOWN_ITEM 等）不能降级为"答错"。
 * 拒绝原因可能是客户端 bug、协议版本不匹配、或篡改 — 这些不是学生的错。
 */

import { z } from 'zod';
import {
  artifactSchema,
  gradableArtifactSchema,
  type Artifact,
  type GradableArtifact,
} from './artifact';
import {
  canvasInteractionEventSchema,
  type CanvasInteractionEvent,
} from './events';
import { publicArtifactSchema, type PublicArtifact } from './public-artifact';

/** 服务端私有判分键；调用方必须与公开Artifact分表或分密级保存。 */
export const artifactGradingKeySchema = z.discriminatedUnion('type', [
  z
    .object({
      schemaVersion: z.literal('1'),
      artifactId: z.string().min(1).max(128),
      type: z.literal('quiz'),
      questions: z
        .array(
          z
            .object({
              questionId: z.string().min(1).max(128),
              optionIds: z.array(z.string().min(1).max(128)).min(2).max(5),
              correctOptionId: z.string().min(1).max(128),
              explanation: z.string().max(300).optional(),
            })
            .strict(),
        )
        .min(1)
        .max(10),
    })
    .strict(),
  z
    .object({
      schemaVersion: z.literal('1'),
      artifactId: z.string().min(1).max(128),
      type: z.literal('classification_game'),
      categoryIds: z.array(z.string().min(1).max(128)).min(2).max(4),
      items: z
        .array(
          z
            .object({
              itemId: z.string().min(1).max(128),
              correctCategoryId: z.string().min(1).max(128),
            })
            .strict(),
        )
        .min(2)
        .max(12),
      successMessage: z.string().max(200).optional(),
    })
    .strict(),
]);

/** 从完整Artifact提取、只允许服务端读取的确定性判分数据。 */
export type ArtifactGradingKey = z.infer<typeof artifactGradingKeySchema>;

/** 完整Artifact经过一次校验后生成的公开投影与私有判分键。 */
export interface PreparedArtifact {
  publicArtifact: PublicArtifact;
  gradingKey: ArtifactGradingKey;
}

/**
 * 提取浏览器安全投影 — 剥离正确答案和解析，只保留学生可见内容。
 *
 * 三类 Artifact 的提取策略不同：
 * - quiz: 去掉 correctOptionId 和 explanation，只保留题干+选项
 * - classification_game: 去掉 correctCategoryId，只保留 item 的 id/label/emoji
 * - pipeline_flow: 渲染型模板，直接透传（无答案概念，无需剥离）
 */
export function projectRenderableArtifact(input: unknown): PublicArtifact {
  const artifact: Artifact = artifactSchema.parse(input);
  if (artifact.type === 'pipeline_flow') {
    return publicArtifactSchema.parse(artifact);
  }
  if (artifact.type === 'quiz') {
    return publicArtifactSchema.parse({
      schemaVersion: artifact.schemaVersion,
      artifactId: artifact.artifactId,
      type: artifact.type,
      title: artifact.title,
      params: {
        questions: artifact.params.questions.map((question) => ({
          id: question.id,
          question: question.question,
          options: question.options,
        })),
      },
    });
  }
  return publicArtifactSchema.parse({
    schemaVersion: artifact.schemaVersion,
    artifactId: artifact.artifactId,
    type: artifact.type,
    title: artifact.title,
    params: {
      prompt: artifact.params.prompt,
      categories: artifact.params.categories,
      items: artifact.params.items.map(({ id, label, emoji }) => ({
        id,
        label,
        emoji,
      })),
    },
  });
}

function prepareValidatedArtifact(
  artifact: GradableArtifact,
): PreparedArtifact {
  if (artifact.type === 'quiz') {
    return {
      publicArtifact: projectRenderableArtifact(artifact),
      gradingKey: artifactGradingKeySchema.parse({
        schemaVersion: artifact.schemaVersion,
        artifactId: artifact.artifactId,
        type: artifact.type,
        questions: artifact.params.questions.map((question) => ({
          questionId: question.id,
          optionIds: question.options.map((option) => option.id),
          correctOptionId: question.correctOptionId,
          explanation: question.explanation,
        })),
      }),
    };
  }

  return {
    publicArtifact: projectRenderableArtifact(artifact),
    gradingKey: artifactGradingKeySchema.parse({
      schemaVersion: artifact.schemaVersion,
      artifactId: artifact.artifactId,
      type: artifact.type,
      categoryIds: artifact.params.categories.map((category) => category.id),
      items: artifact.params.items.map((item) => ({
        itemId: item.id,
        correctCategoryId: item.correctCategoryId,
      })),
      successMessage: artifact.params.successMessage,
    }),
  };
}

/**
 * 验证模型输出的 GradableArtifact，生成 { publicArtifact, gradingKey } 对。
 * 这是服务端接收模型输出的唯一入口 — 同步完成校验、公开投影提取、判分键生成。
 */
export function prepareArtifact(input: unknown): PreparedArtifact {
  return prepareValidatedArtifact(gradableArtifactSchema.parse(input));
}

/** 服务端判分成功后返回的逐项结果，可用于生成可信assessment_graded事件。 */
export interface GradingResult {
  assessmentType: ArtifactGradingKey['type'];
  attemptedItems: number;
  correctItems: number;
  itemResults: readonly { itemId: string; isCorrect: boolean }[];
  feedback?: string;
}

/** 判分拒绝码；无效提交不能降级为“答错”并写入学习事实。 */
export type GradingRejectionCode =
  | 'ARTIFACT_MISMATCH'
  | 'EVENT_TYPE_MISMATCH'
  | 'UNKNOWN_ITEM'
  | 'UNKNOWN_CHOICE'
  | 'INCOMPLETE_SUBMISSION';

/** 确定性判分结果，调用方必须显式处理被拒绝的客户端输入。 */
export type GradingDecision =
  | { ok: true; result: GradingResult }
  | { ok: false; code: GradingRejectionCode };

/**
 * 单选题判分 — 每题独立判对/错，返回 feedback 为那道题的解释文本。
 * 单个 event 只提交一道题，所以 attemptedItems 恒为 1。
 */
function gradeQuiz(
  key: Extract<ArtifactGradingKey, { type: 'quiz' }>,
  event: Extract<CanvasInteractionEvent, { type: 'quiz_answer_submitted' }>,
): GradingDecision {
  const question = key.questions.find(
    (candidate) => candidate.questionId === event.payload.questionId,
  );
  if (!question) return { ok: false, code: 'UNKNOWN_ITEM' };
  if (!question.optionIds.includes(event.payload.selectedOptionId)) {
    return { ok: false, code: 'UNKNOWN_CHOICE' };
  }
  const isCorrect = question.correctOptionId === event.payload.selectedOptionId;
  return {
    ok: true,
    result: {
      assessmentType: 'quiz',
      attemptedItems: 1,
      correctItems: isCorrect ? 1 : 0,
      itemResults: [{ itemId: question.questionId, isCorrect }],
      feedback: question.explanation,
    },
  };
}

/**
 * 分类游戏判分 — 必须提交全部 item 才算完整提交（INCOMPLETE_SUBMISSION 拒绝部分提交）。
 * 全部正确时返回 successMessage 作为反馈。
 */
function gradeClassification(
  key: Extract<ArtifactGradingKey, { type: 'classification_game' }>,
  event: Extract<CanvasInteractionEvent, { type: 'classification_submitted' }>,
): GradingDecision {
  if (event.payload.assignments.length !== key.items.length) {
    return { ok: false, code: 'INCOMPLETE_SUBMISSION' };
  }
  const answers = new Map(key.items.map((item) => [item.itemId, item]));
  const itemResults: { itemId: string; isCorrect: boolean }[] = [];
  for (const assignment of event.payload.assignments) {
    const answer = answers.get(assignment.itemId);
    if (!answer) return { ok: false, code: 'UNKNOWN_ITEM' };
    if (!key.categoryIds.includes(assignment.categoryId)) {
      return { ok: false, code: 'UNKNOWN_CHOICE' };
    }
    itemResults.push({
      itemId: assignment.itemId,
      isCorrect: answer.correctCategoryId === assignment.categoryId,
    });
  }
  const correctItems = itemResults.filter((item) => item.isCorrect).length;
  return {
    ok: true,
    result: {
      assessmentType: 'classification_game',
      attemptedItems: itemResults.length,
      correctItems,
      itemResults,
      feedback:
        correctItems === itemResults.length ? key.successMessage : undefined,
    },
  };
}

/**
 * 服务端判分唯一入口 — 使用保存的 GradingKey 验证客户端提交。
 *
 * ## 安全约束
 *
 * - 客户端自报 isCorrect/masteryScore 永远不参与计算
 * - Schema 不合法的输入抛出 ZodError（协议违规，不是学生的问题）
 * - 通过 Schema 但语义冲突（ID 不匹配、类型不匹配）返回显式拒绝码
 * - 判分键必须与提交事件的 artifactId 一致，防跨 Artifact 提交
 *
 * ## 分派
 *
 * quiz_answer_submitted + quiz key → gradeQuiz()
 * classification_submitted + classification_game key → gradeClassification()
 * 其他组合 → EVENT_TYPE_MISMATCH
 */
export function gradeCanvasSubmission(
  gradingKeyInput: unknown,
  eventInput: unknown,
): GradingDecision {
  const key = artifactGradingKeySchema.parse(gradingKeyInput);
  const event = canvasInteractionEventSchema.parse(eventInput);
  if (key.artifactId !== event.artifactId) {
    return { ok: false, code: 'ARTIFACT_MISMATCH' };
  }
  if (key.type === 'quiz' && event.type === 'quiz_answer_submitted') {
    return gradeQuiz(key, event);
  }
  if (
    key.type === 'classification_game' &&
    event.type === 'classification_submitted'
  ) {
    return gradeClassification(key, event);
  }
  return { ok: false, code: 'EVENT_TYPE_MISMATCH' };
}
