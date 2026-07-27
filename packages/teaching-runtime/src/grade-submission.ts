/**
 * Canvas 提交判分服务 — 将不可信客户端提交提升为可信 assessment_graded 事件。
 *
 * ## 安全约束
 *
 * - 客户端自报 isCorrect 永远不参与计算，判分使用服务端保存的 GradingKey
 * - 先修分数来自知识图谱投影，不能取客户端 payload
 * - 同一 eventId 幂等：重复提交返回已有结果（replayed=true）
 * - IDEMPOTENCY_CONFLICT：同一幂等键但参数不同 → 拒绝
 *
 * ## 事务保证
 *
 * 判分、掌握度投影更新、事件持久化在同一 TeachingUnitOfWork 事务内原子完成。
 * 先锁幂等键，再检查已有事件 — 防止并发重复提交。
 */

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
  DEFAULT_MASTERY_POLICY_VERSION,
  createDefaultLearningProjectionConfig,
  defaultMasteryConfig,
  domainLearningEventSchema,
  projectMasterySnapshot,
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
  /** 由认证边界解析出的可信学生标识，禁止直接取客户端字段。 */
  trustedStudentId: string;
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
  | 'NO_ACTIVE_KNOWLEDGE_NODE'
  | 'IDEMPOTENCY_CONFLICT';

/** 成功结果同时返回可信事件和最新掌握度投影；replayed表示发现已提交的同幂等键事件。 */
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

/**
 * 把不可信Canvas提交提升为可信assessment_graded事件，并在同一事务更新掌握度投影。
 * 本服务不负责HTTP认证；Web组合根必须先验证当前用户对session的访问权。
 * 非法客户端事件返回拒绝结果；无效先修分数或下游Port失败会抛出异常，由调用边界处理。
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
    const trustedStudentId = z
      .string()
      .min(1)
      .max(128)
      .parse(command.trustedStudentId);
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

    return this.unitOfWork.run(async (transaction) => {
      const session = await transaction.sessions.getById(command.sessionId);
      if (!session || session.studentId !== trustedStudentId) {
        return { ok: false, code: 'SESSION_NOT_FOUND' };
      }
      if (!session.knowledgeNodeId) {
        return { ok: false, code: 'NO_ACTIVE_KNOWLEDGE_NODE' };
      }
      const gradingKey = await this.gradingKeys.getGradingKey(
        session.id,
        event.artifactId,
      );
      if (!gradingKey) return { ok: false, code: 'ARTIFACT_NOT_FOUND' };
      const gradingDecision = gradeCanvasSubmission(gradingKey, event);
      if (!gradingDecision.ok) return gradingDecision;
      const idempotencyKey = `canvas:${event.eventId}:assessment_graded`;
      await transaction.events.lockIdempotencyKey(idempotencyKey);

      const existingEvent =
        await transaction.events.getByIdempotencyKey(idempotencyKey);
      const existingMastery = await transaction.mastery.get(
        session.studentId,
        session.knowledgeNodeId,
      );
      if (existingEvent && existingMastery) {
        if (
          existingEvent.eventType !== 'assessment_graded' ||
          existingEvent.eventId !== event.eventId ||
          existingEvent.sessionId !== session.id ||
          existingEvent.studentId !== session.studentId ||
          existingEvent.knowledgeNodeId !== session.knowledgeNodeId ||
          existingEvent.occurredAt !== event.occurredAt ||
          existingEvent.payload.artifactId !== event.artifactId ||
          existingEvent.payload.assessmentType !==
            gradingDecision.result.assessmentType ||
          existingEvent.payload.attemptedItems !==
            gradingDecision.result.attemptedItems ||
          existingEvent.payload.correctItems !==
            gradingDecision.result.correctItems
        ) {
          return { ok: false, code: 'IDEMPOTENCY_CONFLICT' };
        }
        return {
          ok: true,
          replayed: true,
          grading: gradingDecision.result,
          event: existingEvent,
          mastery: existingMastery,
        };
      }
      if (existingEvent) {
        throw new Error('幂等事件已存在但掌握度投影缺失');
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
          prerequisiteScores: [...prerequisiteScores],
          masteryPolicyVersion: DEFAULT_MASTERY_POLICY_VERSION,
          masteryConfig: defaultMasteryConfig,
        },
        occurredAt: event.occurredAt,
        recordedAt: recordedAt.toISOString(),
        source: 'grading_service',
        causationId: event.eventId,
      });

      const projectedMastery = projectMasterySnapshot(
        existingMastery,
        trustedEvent,
        createDefaultLearningProjectionConfig(0),
      );
      if (!projectedMastery) {
        throw new Error('assessment_graded未产生掌握度投影');
      }

      const appendedEvent = await transaction.events.append(trustedEvent);
      const mastery = await transaction.mastery.save({
        expectedVersion: existingMastery?.version ?? 0,
        snapshot: projectedMastery,
      });
      return {
        ok: true,
        replayed: false,
        grading: gradingDecision.result,
        event: appendedEvent,
        mastery,
      };
    });
  }
}
