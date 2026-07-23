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
 * Produce the browser-safe projection for every registered renderer.
 * Render-only templates deliberately stop here: no grading key is invented and
 * no assessment persistence contract is implied.
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

/** 验证模型输出并在单一服务端边界生成公开投影与私有判分键。 */
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
 * 仅在服务端使用保存的判分键验证客户端提交；客户端自报结果永远不参与计算。
 * Schema不合法的输入抛出ZodError；通过Schema但语义冲突的提交返回显式拒绝结果。
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
