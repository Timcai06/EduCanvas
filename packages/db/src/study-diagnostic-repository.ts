import { createHash, randomUUID } from 'node:crypto';
import {
  DEFAULT_MASTERY_POLICY_VERSION,
  createDefaultLearningProjectionConfig,
  defaultMasteryConfig,
  domainLearningEventSchema,
  gradeDiagnostic,
  projectMasterySnapshot,
  studyCourseDefinitionSchema,
} from '@educanvas/teaching-core';
import { and, asc, eq, sql } from 'drizzle-orm';
import { getDb } from './client';
import {
  DrizzleEventStore,
  DrizzleMasteryRepository,
} from './teaching-adapters';
import { conversations, lessonSessions } from './schema';
import {
  diagnosticAttempts,
  diagnosticResponses,
  learningGoals,
  learningObjectives,
} from './schema/study';
import {
  DiagnosticAttemptConflictError,
  StudyPlanNotFoundError,
  type DiagnosticAttemptSnapshot,
  type PersistDiagnosticInput,
  type PersistDiagnosticResult,
} from './study-repository-contracts';
import { persistDiagnosticTransition } from './study-diagnostic-transition';

type Database = ReturnType<typeof getDb>;

function answerFingerprint(input: PersistDiagnosticInput): string {
  const canonicalAnswers = [...input.graded.answers]
    .map((answer) => ({
      questionId: answer.questionId,
      selectedOptionId: answer.selectedOptionId,
    }))
    .sort((left, right) => left.questionId.localeCompare(right.questionId));
  return createHash('sha256')
    .update(JSON.stringify(canonicalAnswers), 'utf8')
    .digest('hex');
}

function attemptSnapshot(
  row: typeof diagnosticAttempts.$inferSelect,
  input: PersistDiagnosticInput,
): DiagnosticAttemptSnapshot {
  return {
    id: row.id,
    clientAttemptId: row.clientAttemptId,
    definitionVersion: row.definitionVersion,
    attemptedItems: row.attemptedItems,
    correctItems: row.correctItems,
    submittedAt: row.submittedAt.toISOString(),
    progress: input.graded.progress,
    nextObjectiveKey: input.graded.nextObjectiveKey,
  };
}

/**
 * 诊断事实写入仓储。客户端提交先由 teaching-core 判分，再在同一事务写
 * Attempt/Responses、可信 assessment 事件和 mastery 投影。
 */
export class DrizzleStudyDiagnosticRepository {
  constructor(private readonly providedDatabase?: Database) {}

  private get database(): Database {
    return this.providedDatabase ?? getDb();
  }

  async submit(
    rawInput: PersistDiagnosticInput,
  ): Promise<PersistDiagnosticResult> {
    const course = studyCourseDefinitionSchema.parse(rawInput.course);
    const gradingDecision = gradeDiagnostic(course, {
      attemptId: rawInput.graded.attemptId,
      answers: rawInput.graded.answers.map((answer) => ({
        questionId: answer.questionId,
        selectedOptionId: answer.selectedOptionId,
      })),
    });
    if (!gradingDecision.ok) throw new StudyPlanNotFoundError();
    const input = {
      ...rawInput,
      course,
      graded: gradingDecision.result,
    };
    const fingerprint = answerFingerprint(input);
    return this.database.transaction(async (transaction) => {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`diagnostic-attempt:${input.graded.attemptId}`}, 0))`,
      );
      const [existing] = await transaction
        .select()
        .from(diagnosticAttempts)
        .where(eq(diagnosticAttempts.clientAttemptId, input.graded.attemptId))
        .limit(1);
      if (existing) {
        if (
          existing.studentId !== input.trustedStudentId ||
          existing.goalId !== input.goalId ||
          existing.sessionId !== input.sessionId ||
          existing.definitionVersion !== input.graded.definitionVersion ||
          existing.answerFingerprint !== fingerprint
        ) {
          throw new DiagnosticAttemptConflictError();
        }
        await persistDiagnosticTransition(transaction, {
          trustedStudentId: input.trustedStudentId,
          sessionId: input.sessionId,
          attemptId: existing.id,
        });
        return {
          replayed: true,
          attempt: attemptSnapshot(existing, input),
        };
      }

      const [ownedGoal] = await transaction
        .select({
          courseSlug: learningGoals.courseSlug,
          courseVersion: learningGoals.courseVersion,
          gradeBand: learningGoals.gradeBand,
          notebookId: learningGoals.notebookId,
        })
        .from(learningGoals)
        .innerJoin(
          conversations,
          eq(conversations.spaceId, learningGoals.notebookId),
        )
        .innerJoin(
          lessonSessions,
          eq(lessonSessions.conversationId, conversations.id),
        )
        .where(
          and(
            eq(learningGoals.id, input.goalId),
            eq(learningGoals.studentId, input.trustedStudentId),
            eq(learningGoals.status, 'active'),
            eq(lessonSessions.id, input.sessionId),
            eq(lessonSessions.studentId, input.trustedStudentId),
            eq(lessonSessions.status, 'active'),
          ),
        )
        .limit(1);
      if (
        !ownedGoal ||
        ownedGoal.courseSlug !== course.courseSlug ||
        ownedGoal.courseVersion !== course.version ||
        ownedGoal.gradeBand !== course.gradeBand ||
        input.graded.definitionVersion !== course.diagnostic.version
      ) {
        throw new StudyPlanNotFoundError();
      }
      const objectiveRows = await transaction
        .select()
        .from(learningObjectives)
        .where(eq(learningObjectives.goalId, input.goalId))
        .orderBy(asc(learningObjectives.sequence));
      const objectiveByKey = new Map(
        objectiveRows.map((objective) => [objective.objectiveKey, objective]),
      );
      const courseMatches =
        objectiveRows.length === course.objectives.length &&
        course.objectives.every((objective) => {
          const stored = objectiveByKey.get(objective.objectiveKey);
          return (
            stored?.knowledgeNodeId === objective.knowledgeNodeId &&
            stored.sequence === objective.sequence &&
            JSON.stringify(stored.prerequisiteObjectiveKeys) ===
              JSON.stringify(objective.prerequisiteObjectiveKeys)
          );
        });
      if (!courseMatches) throw new StudyPlanNotFoundError();

      const now = new Date();
      const [createdAttempt] = await transaction
        .insert(diagnosticAttempts)
        .values({
          clientAttemptId: input.graded.attemptId,
          goalId: input.goalId,
          sessionId: input.sessionId,
          studentId: input.trustedStudentId,
          definitionVersion: input.graded.definitionVersion,
          answerFingerprint: fingerprint,
          attemptedItems: input.graded.attemptedItems,
          correctItems: input.graded.correctItems,
          submittedAt: now,
        })
        .returning();
      if (!createdAttempt) throw new Error('诊断Attempt写入失败');
      await transaction.insert(diagnosticResponses).values(
        input.graded.answers.map((answer) => {
          const objective = objectiveByKey.get(answer.objectiveKey);
          if (
            !objective ||
            objective.knowledgeNodeId !== answer.knowledgeNodeId
          ) {
            throw new StudyPlanNotFoundError();
          }
          return {
            attemptId: createdAttempt.id,
            questionId: answer.questionId,
            objectiveId: objective.id,
            selectedOptionId: answer.selectedOptionId,
            isCorrect: answer.isCorrect,
            gradingVersion: input.graded.definitionVersion,
            createdAt: now,
          };
        }),
      );

      const events = new DrizzleEventStore(transaction);
      const mastery = new DrizzleMasteryRepository(transaction);
      const masteryByNode = new Map(
        await Promise.all(
          objectiveRows.map(
            async (objective) =>
              [
                objective.knowledgeNodeId,
                await mastery.get(
                  input.trustedStudentId,
                  objective.knowledgeNodeId,
                ),
              ] as const,
          ),
        ),
      );
      for (const answer of input.graded.answers) {
        const objective = objectiveByKey.get(answer.objectiveKey);
        if (!objective) throw new StudyPlanNotFoundError();
        const prerequisiteScores = objective.prerequisiteObjectiveKeys.map(
          (key) => {
            const prerequisite = objectiveByKey.get(key);
            if (!prerequisite) throw new StudyPlanNotFoundError();
            return (
              masteryByNode.get(prerequisite.knowledgeNodeId)?.masteryScore ?? 0
            );
          },
        );
        const idempotencyKey = `diagnostic:${input.graded.attemptId}:${createHash(
          'sha256',
        )
          .update(answer.questionId, 'utf8')
          .digest('hex')
          .slice(0, 16)}`;
        await events.lockIdempotencyKey(idempotencyKey);
        const sequence = await events.allocateSequence(input.sessionId);
        const event = domainLearningEventSchema.parse({
          schemaVersion: '1',
          eventId: randomUUID(),
          idempotencyKey,
          studentId: input.trustedStudentId,
          sessionId: input.sessionId,
          knowledgeNodeId: objective.knowledgeNodeId,
          sequence,
          eventType: 'assessment_graded',
          payload: {
            artifactId: `diagnostic:${input.goalId}`,
            assessmentType: 'quiz',
            attemptedItems: 1,
            correctItems: answer.isCorrect ? 1 : 0,
            usedHint: false,
            prerequisiteScores,
            masteryPolicyVersion: DEFAULT_MASTERY_POLICY_VERSION,
            masteryConfig: defaultMasteryConfig,
          },
          occurredAt: now.toISOString(),
          recordedAt: now.toISOString(),
          source: 'grading_service',
          causationId: `diagnostic:${input.graded.attemptId}`,
        });
        const previous = masteryByNode.get(objective.knowledgeNodeId) ?? null;
        const projected = projectMasterySnapshot(
          previous,
          event,
          createDefaultLearningProjectionConfig(0),
        );
        if (!projected) throw new Error('诊断事件未产生掌握度投影');
        await events.append(event);
        const saved = await mastery.save({
          snapshot: projected,
          expectedVersion: previous?.version ?? 0,
        });
        masteryByNode.set(objective.knowledgeNodeId, saved);
      }
      await persistDiagnosticTransition(transaction, {
        trustedStudentId: input.trustedStudentId,
        sessionId: input.sessionId,
        attemptId: createdAttempt.id,
      });
      return {
        replayed: false,
        attempt: attemptSnapshot(createdAttempt, input),
      };
    });
  }
}
