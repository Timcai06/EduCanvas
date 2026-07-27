import { z } from 'zod';
import { learnerGradeBandSchema } from './learner-profile';

const stableKeySchema = z
  .string()
  .min(1)
  .max(128)
  .regex(
    /^[a-z0-9][a-z0-9._:-]*$/,
    '稳定标识只能使用小写字母、数字、点、冒号、下划线和连字符',
  );

/** 目标图限定 6–12 个节点，既能表达一个单元，又避免首版生成不可审查的百级图。 */
export const learningObjectiveDefinitionSchema = z
  .object({
    objectiveKey: stableKeySchema,
    knowledgeNodeId: stableKeySchema,
    title: z.string().min(1).max(80),
    description: z.string().min(1).max(300),
    sequence: z.number().int().min(1).max(12),
    prerequisiteObjectiveKeys: z.array(stableKeySchema).max(4),
  })
  .strict();

export type LearningObjectiveDefinition = z.infer<
  typeof learningObjectiveDefinitionSchema
>;

const diagnosticOptionSchema = z
  .object({
    id: stableKeySchema,
    text: z.string().min(1).max(120),
  })
  .strict();

/** 服务端课程目录中的完整诊断题；正确答案不会进入公开投影。 */
export const diagnosticQuestionDefinitionSchema = z
  .object({
    questionId: stableKeySchema,
    objectiveKey: stableKeySchema,
    prompt: z.string().min(1).max(300),
    options: z.array(diagnosticOptionSchema).min(2).max(5),
    correctOptionId: stableKeySchema,
  })
  .strict()
  .superRefine((question, context) => {
    const optionIds = question.options.map((option) => option.id);
    if (new Set(optionIds).size !== optionIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['options'],
        message: '诊断选项ID不能重复',
      });
    }
    if (!optionIds.includes(question.correctOptionId)) {
      context.addIssue({
        code: 'custom',
        path: ['correctOptionId'],
        message: '诊断正确选项必须存在',
      });
    }
  });

export type DiagnosticQuestionDefinition = z.infer<
  typeof diagnosticQuestionDefinitionSchema
>;

/** 一个受信课程版本包含目标图和覆盖其中一部分目标的短诊断。 */
export const studyCourseDefinitionSchema = z
  .object({
    courseSlug: stableKeySchema,
    version: stableKeySchema,
    gradeBand: learnerGradeBandSchema,
    title: z.string().min(1).max(120),
    objectives: z.array(learningObjectiveDefinitionSchema).min(6).max(12),
    diagnostic: z
      .object({
        version: stableKeySchema,
        questions: z.array(diagnosticQuestionDefinitionSchema).min(3).max(10),
      })
      .strict(),
  })
  .strict()
  .superRefine((course, context) => {
    const objectiveKeys = course.objectives.map(
      (objective) => objective.objectiveKey,
    );
    const knowledgeNodeIds = course.objectives.map(
      (objective) => objective.knowledgeNodeId,
    );
    if (new Set(objectiveKeys).size !== objectiveKeys.length) {
      context.addIssue({
        code: 'custom',
        path: ['objectives'],
        message: '学习目标ID不能重复',
      });
    }
    if (new Set(knowledgeNodeIds).size !== knowledgeNodeIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['objectives'],
        message: '知识节点ID不能重复',
      });
    }
    const byKey = new Map(
      course.objectives.map((objective) => [objective.objectiveKey, objective]),
    );
    const expectedSequences = course.objectives.map(
      (_objective, index) => index + 1,
    );
    const actualSequences = course.objectives.map(
      (objective) => objective.sequence,
    );
    if (
      actualSequences.some(
        (sequence, index) => sequence !== expectedSequences[index],
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['objectives'],
        message: '学习目标必须按从1开始的连续sequence排列',
      });
    }
    course.objectives.forEach((objective, objectiveIndex) => {
      const prerequisites = objective.prerequisiteObjectiveKeys;
      if (new Set(prerequisites).size !== prerequisites.length) {
        context.addIssue({
          code: 'custom',
          path: ['objectives', objectiveIndex, 'prerequisiteObjectiveKeys'],
          message: '同一目标的先修ID不能重复',
        });
      }
      prerequisites.forEach((prerequisite) => {
        const prerequisiteObjective = byKey.get(prerequisite);
        if (
          !prerequisiteObjective ||
          prerequisiteObjective.sequence >= objective.sequence
        ) {
          context.addIssue({
            code: 'custom',
            path: ['objectives', objectiveIndex, 'prerequisiteObjectiveKeys'],
            message: '先修目标必须存在且排在当前目标之前',
          });
        }
      });
    });
    const questionIds = course.diagnostic.questions.map(
      (question) => question.questionId,
    );
    const coveredObjectives = course.diagnostic.questions.map(
      (question) => question.objectiveKey,
    );
    if (new Set(questionIds).size !== questionIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['diagnostic', 'questions'],
        message: '诊断题ID不能重复',
      });
    }
    if (new Set(coveredObjectives).size !== coveredObjectives.length) {
      context.addIssue({
        code: 'custom',
        path: ['diagnostic', 'questions'],
        message: 'P1每个目标最多由一道诊断题覆盖',
      });
    }
    course.diagnostic.questions.forEach((question, questionIndex) => {
      if (!byKey.has(question.objectiveKey)) {
        context.addIssue({
          code: 'custom',
          path: ['diagnostic', 'questions', questionIndex, 'objectiveKey'],
          message: '诊断题必须映射到课程目标',
        });
      }
    });
  });

export type StudyCourseDefinition = z.infer<typeof studyCourseDefinitionSchema>;

/** 浏览器只得到题面和选项，永远不包含正确答案。 */
export const publicDiagnosticSchema = z
  .object({
    version: stableKeySchema,
    questions: z
      .array(
        z
          .object({
            questionId: stableKeySchema,
            prompt: z.string().min(1).max(300),
            options: z.array(diagnosticOptionSchema).min(2).max(5),
          })
          .strict(),
      )
      .min(3)
      .max(10),
  })
  .strict();

export type PublicDiagnostic = z.infer<typeof publicDiagnosticSchema>;

/** 客户端提交必须一次覆盖整份短诊断；attemptId提供网络重试幂等身份。 */
export const diagnosticSubmissionSchema = z
  .object({
    attemptId: z.uuid(),
    answers: z
      .array(
        z
          .object({
            questionId: stableKeySchema,
            selectedOptionId: stableKeySchema,
          })
          .strict(),
      )
      .min(3)
      .max(10),
  })
  .strict();

export type DiagnosticSubmission = z.infer<typeof diagnosticSubmissionSchema>;

export const diagnosticObjectiveStatuses = [
  'strength',
  'focus',
  'not_started',
] as const;

export type DiagnosticObjectiveStatus =
  (typeof diagnosticObjectiveStatuses)[number];

export interface DiagnosticObjectiveProgress {
  objectiveKey: string;
  knowledgeNodeId: string;
  title: string;
  status: DiagnosticObjectiveStatus;
  attemptedItems: number;
  correctItems: number;
}

export interface GradedDiagnosticAnswer {
  questionId: string;
  objectiveKey: string;
  knowledgeNodeId: string;
  selectedOptionId: string;
  isCorrect: boolean;
}

export interface GradedDiagnostic {
  attemptId: string;
  definitionVersion: string;
  attemptedItems: number;
  correctItems: number;
  answers: readonly GradedDiagnosticAnswer[];
  progress: readonly DiagnosticObjectiveProgress[];
  nextObjectiveKey: string | null;
}

export type DiagnosticGradingDecision =
  | { ok: true; result: GradedDiagnostic }
  | {
      ok: false;
      code:
        | 'DUPLICATE_QUESTION'
        | 'INCOMPLETE_DIAGNOSTIC'
        | 'UNKNOWN_QUESTION'
        | 'UNKNOWN_OPTION';
    };

/** 从完整课程目录生成浏览器安全诊断题面。 */
export function projectPublicDiagnostic(
  rawCourse: StudyCourseDefinition,
): PublicDiagnostic {
  const course = studyCourseDefinitionSchema.parse(rawCourse);
  return publicDiagnosticSchema.parse({
    version: course.diagnostic.version,
    questions: course.diagnostic.questions.map((question) => ({
      questionId: question.questionId,
      prompt: question.prompt,
      options: question.options,
    })),
  });
}

/**
 * 使用受信课程答案键确定性判分，并为全部目标生成三态诊断投影。
 * 客户端自报正确性、目标ID或分数都不在输入Schema中。
 */
export function gradeDiagnostic(
  rawCourse: StudyCourseDefinition,
  rawSubmission: DiagnosticSubmission,
): DiagnosticGradingDecision {
  const course = studyCourseDefinitionSchema.parse(rawCourse);
  const submission = diagnosticSubmissionSchema.parse(rawSubmission);
  const answerByQuestion = new Map<string, string>();
  for (const answer of submission.answers) {
    if (answerByQuestion.has(answer.questionId)) {
      return { ok: false, code: 'DUPLICATE_QUESTION' };
    }
    answerByQuestion.set(answer.questionId, answer.selectedOptionId);
  }
  if (answerByQuestion.size !== course.diagnostic.questions.length) {
    return { ok: false, code: 'INCOMPLETE_DIAGNOSTIC' };
  }
  const knownQuestionIds = new Set(
    course.diagnostic.questions.map((question) => question.questionId),
  );
  if (
    [...answerByQuestion.keys()].some(
      (questionId) => !knownQuestionIds.has(questionId),
    )
  ) {
    return { ok: false, code: 'UNKNOWN_QUESTION' };
  }
  const objectiveByKey = new Map(
    course.objectives.map((objective) => [objective.objectiveKey, objective]),
  );
  const answers: GradedDiagnosticAnswer[] = [];
  for (const question of course.diagnostic.questions) {
    const selectedOptionId = answerByQuestion.get(question.questionId);
    if (!selectedOptionId) {
      return { ok: false, code: 'INCOMPLETE_DIAGNOSTIC' };
    }
    if (!question.options.some((option) => option.id === selectedOptionId)) {
      return { ok: false, code: 'UNKNOWN_OPTION' };
    }
    const objective = objectiveByKey.get(question.objectiveKey);
    if (!objective) {
      throw new Error('课程Schema通过后诊断目标仍不存在');
    }
    answers.push({
      questionId: question.questionId,
      objectiveKey: question.objectiveKey,
      knowledgeNodeId: objective.knowledgeNodeId,
      selectedOptionId,
      isCorrect: selectedOptionId === question.correctOptionId,
    });
  }
  const answerByObjective = new Map(
    answers.map((answer) => [answer.objectiveKey, answer]),
  );
  const progress = course.objectives.map((objective) => {
    const answer = answerByObjective.get(objective.objectiveKey);
    return {
      objectiveKey: objective.objectiveKey,
      knowledgeNodeId: objective.knowledgeNodeId,
      title: objective.title,
      status: answer
        ? answer.isCorrect
          ? ('strength' as const)
          : ('focus' as const)
        : ('not_started' as const),
      attemptedItems: answer ? 1 : 0,
      correctItems: answer?.isCorrect ? 1 : 0,
    };
  });
  const nextObjective =
    progress.find((objective) => objective.status === 'focus') ??
    progress.find((objective) => objective.status === 'not_started') ??
    null;
  return {
    ok: true,
    result: {
      attemptId: submission.attemptId,
      definitionVersion: course.diagnostic.version,
      attemptedItems: answers.length,
      correctItems: answers.filter((answer) => answer.isCorrect).length,
      answers,
      progress,
      nextObjectiveKey: nextObjective?.objectiveKey ?? null,
    },
  };
}
