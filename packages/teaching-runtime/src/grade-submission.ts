import {
  canvasInteractionEventSchema,
  type CanvasInteractionEvent,
} from '@educanvas/canvas-protocol';
import {
  gradeCanvasSubmission,
  type ArtifactGradingKey,
  type GradingRejectionCode,
  type GradingResult,
} from '@educanvas/canvas-protocol/server';
import {
  calculateMastery,
  domainLearningEventSchema,
  getReviewIntervalDays,
  type DomainLearningEvent,
  type MasterySnapshot,
  type TeachingUnitOfWork,
} from '@educanvas/teaching-core';
import { z } from 'zod';

/** 应用服务只读取私有判分键，不感知其数据库表或ORM实现。 */
export interface ArtifactGradingKeyReader {
  getGradingKey(
    sessionId: string,
    artifactId: string,
  ): Promise<ArtifactGradingKey | null>;
}

const prerequisiteScoresSchema = z.array(z.number().min(0).max(1));

/** 服务端判分命令；先修分数必须来自知识图谱投影，不能取自客户端payload。 */
export interface GradeCanvasSubmissionCommand {
  sessionId: string;
  clientEvent: unknown;
  prerequisiteScores: readonly number[];
}

/** 应用服务拒绝码，不把非法或越界输入降级成普通答错。 */
export type GradeCanvasSubmissionRejection =
  | GradingRejectionCode
  | 'INVALID_CLIENT_EVENT'
  | 'EVENT_NOT_GRADABLE'
  | 'ARTIFACT_NOT_FOUND'
  | 'SESSION_NOT_FOUND'
  | 'NO_ACTIVE_KNOWLEDGE_NODE';

/** 成功结果同时返回可信事件和最新掌握度投影，replayed表示安全幂等重试。 */
export type GradeCanvasSubmissionOutcome =
  | {
      ok: true;
      replayed: boolean;
      grading: GradingResult;
      event: DomainLearningEvent;
      mastery: MasterySnapshot;
    }
  | { ok: false; code: GradeCanvasSubmissionRejection };

type GradableEvent = Extract<
  CanvasInteractionEvent,
  { type: 'quiz_answer_submitted' | 'classification_submitted' }
>;

function isGradableEvent(
  event: CanvasInteractionEvent,
): event is GradableEvent {
  return (
    event.type === 'quiz_answer_submitted' ||
    event.type === 'classification_submitted'
  );
}

function daysBetween(previousIso: string | null, current: Date): number {
  if (!previousIso) return 0;
  return Math.max(
    0,
    (current.getTime() - new Date(previousIso).getTime()) / 86_400_000,
  );
}

/**
 * 把不可信Canvas提交提升为可信assessment_graded事件，并在同一事务更新掌握度投影。
 * 本服务不负责HTTP认证；Web组合根必须先验证当前用户对session的访问权。
 */
export class GradeCanvasSubmissionService {
  constructor(
    private readonly gradingKeys: ArtifactGradingKeyReader,
    private readonly unitOfWork: TeachingUnitOfWork,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(
    command: GradeCanvasSubmissionCommand,
  ): Promise<GradeCanvasSubmissionOutcome> {
    const parsedEvent = canvasInteractionEventSchema.safeParse(
      command.clientEvent,
    );
    if (!parsedEvent.success) {
      return { ok: false, code: 'INVALID_CLIENT_EVENT' };
    }
    if (!isGradableEvent(parsedEvent.data)) {
      return { ok: false, code: 'EVENT_NOT_GRADABLE' };
    }
    const event = parsedEvent.data;
    const prerequisiteScores = prerequisiteScoresSchema.parse(
      command.prerequisiteScores,
    );
    const gradingKey = await this.gradingKeys.getGradingKey(
      command.sessionId,
      event.artifactId,
    );
    if (!gradingKey) return { ok: false, code: 'ARTIFACT_NOT_FOUND' };
    const gradingDecision = gradeCanvasSubmission(gradingKey, event);
    if (!gradingDecision.ok) return gradingDecision;

    return this.unitOfWork.run(async (transaction) => {
      const session = await transaction.sessions.getById(command.sessionId);
      if (!session) return { ok: false, code: 'SESSION_NOT_FOUND' };
      if (!session.knowledgeNodeId) {
        return { ok: false, code: 'NO_ACTIVE_KNOWLEDGE_NODE' };
      }

      const idempotencyKey = `canvas:${event.eventId}:assessment_graded`;
      const existingEvent =
        await transaction.events.getByIdempotencyKey(idempotencyKey);
      const existingMastery = await transaction.mastery.get(
        session.studentId,
        session.knowledgeNodeId,
      );
      if (existingEvent && existingMastery) {
        return {
          ok: true,
          replayed: true,
          grading: gradingDecision.result,
          event: existingEvent,
          mastery: existingMastery,
        };
      }

      const priorEvents = await transaction.events.listBySession(session.id);
      const usedHint = priorEvents.some(
        (priorEvent) =>
          priorEvent.eventType === 'hint_recorded' &&
          priorEvent.payload.artifactId === event.artifactId,
      );
      const recordedAt = this.now();
      const sequence = await transaction.events.allocateSequence(session.id);
      const trustedEvent = domainLearningEventSchema.parse({
        schemaVersion: '1',
        eventId: event.eventId,
        idempotencyKey,
        studentId: session.studentId,
        sessionId: session.id,
        knowledgeNodeId: session.knowledgeNodeId,
        sequence,
        eventType: 'assessment_graded',
        payload: {
          artifactId: event.artifactId,
          assessmentType: gradingDecision.result.assessmentType,
          attemptedItems: gradingDecision.result.attemptedItems,
          correctItems: gradingDecision.result.correctItems,
          usedHint,
        },
        occurredAt: event.occurredAt,
        recordedAt: recordedAt.toISOString(),
        source: 'grading_service',
        causationId: event.eventId,
      });

      const attemptCount =
        (existingMastery?.attemptCount ?? 0) +
        gradingDecision.result.attemptedItems;
      const correctCount =
        (existingMastery?.correctCount ?? 0) +
        gradingDecision.result.correctItems;
      const activeMisconceptions = existingMastery?.activeMisconceptions ?? [];
      const masteryCalculation = calculateMastery({
        previousScore: existingMastery?.masteryScore ?? 0,
        attemptCount,
        correctCount,
        hintCount: existingMastery?.hintCount ?? 0,
        activeMisconceptionCount: activeMisconceptions.length,
        daysSincePracticed: daysBetween(
          existingMastery?.lastPracticedAt ?? null,
          recordedAt,
        ),
        prerequisiteScores: [...prerequisiteScores],
      });
      const reviewIntervalDays = getReviewIntervalDays(
        masteryCalculation.score,
        activeMisconceptions.length,
      );
      const nextReviewAt = new Date(
        recordedAt.getTime() + reviewIntervalDays * 86_400_000,
      ).toISOString();

      await transaction.events.append(trustedEvent);
      const mastery = await transaction.mastery.save({
        expectedVersion: existingMastery?.version ?? 0,
        snapshot: {
          studentId: session.studentId,
          knowledgeNodeId: session.knowledgeNodeId,
          masteryScore: masteryCalculation.score,
          attemptCount,
          correctCount,
          hintCount: existingMastery?.hintCount ?? 0,
          activeMisconceptions,
          lastPracticedAt: recordedAt.toISOString(),
          nextReviewAt,
          version: existingMastery?.version ?? 0,
        },
      });
      return {
        ok: true,
        replayed: false,
        grading: gradingDecision.result,
        event: trustedEvent,
        mastery,
      };
    });
  }
}
