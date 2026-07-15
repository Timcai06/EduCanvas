import {
  decideAssessmentExit,
  defaultMasteryConfig,
  domainLearningEventSchema,
  evaluateTransition,
  masteryConfigSchema,
  misconceptionTagSchema,
  resolveTransitionCandidate,
  teachingTransitionCandidateSignalSchema,
  type AssessmentEvidence,
  type AssessmentExit,
  type DomainLearningEvent,
  type LessonSessionSnapshot,
  type MasteryConfig,
  type MasterySnapshot,
  type TeachingState,
  type TeachingTransitionCandidateSignal,
  type TeachingUnitOfWork,
} from '@educanvas/teaching-core';
import { z } from 'zod';

/**
 * 候选信号命令只含认证主体、会话和因果ID；目标状态、掌握度、模型文本和浏览器状态均不可传入。
 */
export const progressTeachingStateCommandSchema = z
  .object({
    trustedStudentId: z.string().min(1).max(128),
    sessionId: z.uuid(),
    causationId: z.string().min(1).max(80),
    candidateSignal: teachingTransitionCandidateSignalSchema,
  })
  .strict();

export type ProgressTeachingStateCommand = z.infer<
  typeof progressTeachingStateCommandSchema
>;

/** 课程策略由服务端组合根读取，不能从HTTP/模型命令中透传。 */
export const teachingProgressionPolicySchema = z
  .object({
    policyVersion: z.string().min(1).max(64),
    minimumPracticeEvents: z.number().int().nonnegative(),
    remediationTarget: z.enum(['EXPLAIN', 'PRACTICE']),
    prerequisiteScores: z.array(z.number().min(0).max(1)),
    severeMisconceptions: z.array(misconceptionTagSchema),
    masteryConfig: masteryConfigSchema.default(defaultMasteryConfig),
  })
  .strict();

export type TeachingProgressionPolicy = z.infer<
  typeof teachingProgressionPolicySchema
>;

/** 版本化课程策略读取Port；实现可以来自静态课程Registry或数据库只读投影。 */
export interface TeachingProgressionPolicyReader {
  getPolicy(input: {
    sessionId: string;
    knowledgeNodeId: string;
  }): Promise<unknown>;
}

export type ProgressTeachingStateRejectionCode =
  | 'INVALID_COMMAND'
  | 'SESSION_NOT_FOUND'
  | 'NO_ACTIVE_KNOWLEDGE_NODE'
  | 'CANDIDATE_NOT_APPLICABLE'
  | 'INSUFFICIENT_PRACTICE'
  | 'ASSESSMENT_DECISION_REQUIRED'
  | 'ADVANCE_HAS_NO_TARGET_STATE'
  | 'ILLEGAL_TRANSITION'
  | 'IDEMPOTENCY_CONFLICT';

/** 成功时要么提交一个状态事实，要么明确给出ASSESS的ADVANCE出口。 */
export type ProgressTeachingStateOutcome =
  | {
      ok: true;
      action: 'TRANSITION';
      replayed: boolean;
      event: Extract<DomainLearningEvent, { eventType: 'state_transition' }>;
      session: LessonSessionSnapshot;
    }
  | {
      ok: true;
      action: 'ADVANCE';
      replayed: boolean;
      event: Extract<
        DomainLearningEvent,
        { eventType: 'assessment_exit_decided' }
      >;
      assessmentExit: AssessmentExit;
      session: LessonSessionSnapshot;
    }
  | { ok: false; code: ProgressTeachingStateRejectionCode };

function idempotencyKey(command: ProgressTeachingStateCommand): string {
  return `state:${command.sessionId}:${command.causationId}`;
}

function eventsInCurrentState(
  events: readonly DomainLearningEvent[],
  currentState: TeachingState,
): readonly DomainLearningEvent[] {
  let startIndex = 0;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const candidate = events[index];
    if (
      candidate?.eventType === 'state_transition' &&
      candidate.payload.to === currentState
    ) {
      startIndex = index + 1;
      break;
    }
  }
  return events.slice(startIndex);
}

function assessmentEvidence(
  events: readonly DomainLearningEvent[],
  knowledgeNodeId: string,
): { attemptCount: number; correctCount: number } {
  return events.reduce(
    (evidence, event) => {
      if (
        event.eventType !== 'assessment_graded' ||
        event.knowledgeNodeId !== knowledgeNodeId
      ) {
        return evidence;
      }
      return {
        attemptCount: evidence.attemptCount + event.payload.attemptedItems,
        correctCount: evidence.correctCount + event.payload.correctItems,
      };
    },
    { attemptCount: 0, correctCount: 0 },
  );
}

function decideTrustedAssessmentExit(
  mastery: MasterySnapshot | null,
  knowledgeNodeId: string,
  events: readonly DomainLearningEvent[],
  policy: TeachingProgressionPolicy,
): { assessmentExit: AssessmentExit; evidence: AssessmentEvidence } {
  const evidence = assessmentEvidence(events, knowledgeNodeId);
  const severe = new Set(policy.severeMisconceptions);
  const masteryScore = mastery?.masteryScore ?? 0;
  const trustedEvidence: AssessmentEvidence = {
    score: masteryScore,
    // v1投影尚未持久化单独的“曾掌握”位；达到进入阈值即进入滞后分支。
    previouslyMastered:
      mastery !== null && masteryScore >= policy.masteryConfig.enterThreshold,
    prerequisiteScores: policy.prerequisiteScores,
    recentAttemptCount: evidence.attemptCount,
    recentCorrectCount: evidence.correctCount,
    hasActiveSevereMisconception:
      mastery?.activeMisconceptions.some((tag) => severe.has(tag)) ?? false,
  };
  return {
    assessmentExit: decideAssessmentExit(trustedEvidence, policy.masteryConfig),
    evidence: trustedEvidence,
  };
}

function isSameAssessmentExitFact(
  event: DomainLearningEvent,
  command: ProgressTeachingStateCommand,
): event is Extract<
  DomainLearningEvent,
  { eventType: 'assessment_exit_decided' }
> {
  return (
    event.eventType === 'assessment_exit_decided' &&
    event.sessionId === command.sessionId &&
    event.studentId === command.trustedStudentId &&
    event.causationId === command.causationId &&
    event.source === 'teaching_runtime' &&
    event.payload.from === 'ASSESS' &&
    event.payload.signal === command.candidateSignal
  );
}

function assessmentExitFromFact(
  event: Extract<DomainLearningEvent, { eventType: 'assessment_exit_decided' }>,
): AssessmentExit {
  return {
    decision: event.payload.decision,
    reasons: event.payload.reasons,
    recentAccuracy: event.payload.recentAccuracy,
  };
}

function isSameTransitionFact(
  event: DomainLearningEvent,
  command: ProgressTeachingStateCommand,
): event is Extract<DomainLearningEvent, { eventType: 'state_transition' }> {
  if (
    event.eventType !== 'state_transition' ||
    event.sessionId !== command.sessionId ||
    event.studentId !== command.trustedStudentId ||
    event.causationId !== command.causationId ||
    event.source !== 'teaching_runtime' ||
    event.payload.reason !== command.candidateSignal
  ) {
    return false;
  }
  const resolution = resolveTransitionCandidate(
    event.payload.from,
    command.candidateSignal,
  );
  if (!resolution.ok) return false;
  return (
    resolution.kind === 'ASSESSMENT_EXIT' || resolution.to === event.payload.to
  );
}

/**
 * 提交可信教学状态事实。所有读写都在同一UoW中执行；同一因果ID先加幂等锁，
 * 状态更新再由SessionRepository的expectedVersion提供并发保护。
 */
export class ProgressTeachingStateService {
  constructor(
    private readonly unitOfWork: TeachingUnitOfWork,
    private readonly policies: TeachingProgressionPolicyReader,
    private readonly createEventId: () => string = () => crypto.randomUUID(),
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(rawCommand: unknown): Promise<ProgressTeachingStateOutcome> {
    const parsed = progressTeachingStateCommandSchema.safeParse(rawCommand);
    if (!parsed.success) return { ok: false, code: 'INVALID_COMMAND' };
    const command = parsed.data;

    return this.unitOfWork.run(async (transaction) => {
      // 先串行化同一因果命令，再读取会话，避免等待锁期间持有过期version快照。
      const key = idempotencyKey(command);
      await transaction.events.lockIdempotencyKey(key);
      const session = await transaction.sessions.getById(command.sessionId);
      if (!session || session.studentId !== command.trustedStudentId) {
        return { ok: false, code: 'SESSION_NOT_FOUND' };
      }

      const existing = await transaction.events.getByIdempotencyKey(key);
      if (existing) {
        if (isSameAssessmentExitFact(existing, command)) {
          return {
            ok: true,
            action: 'ADVANCE',
            replayed: true,
            event: existing,
            assessmentExit: assessmentExitFromFact(existing),
            session,
          };
        }
        if (!isSameTransitionFact(existing, command)) {
          return { ok: false, code: 'IDEMPOTENCY_CONFLICT' };
        }
        return {
          ok: true,
          action: 'TRANSITION',
          replayed: true,
          event: existing,
          session,
        };
      }
      if (!session.knowledgeNodeId) {
        return { ok: false, code: 'NO_ACTIVE_KNOWLEDGE_NODE' };
      }

      const resolution = resolveTransitionCandidate(
        session.state,
        command.candidateSignal,
      );
      if (!resolution.ok) {
        return { ok: false, code: resolution.code };
      }
      const policy = teachingProgressionPolicySchema.parse(
        await this.policies.getPolicy({
          sessionId: session.id,
          knowledgeNodeId: session.knowledgeNodeId,
        }),
      );
      const allEvents = await transaction.events.listBySession(session.id);
      const currentStateEvents = eventsInCurrentState(allEvents, session.state);
      const practiceEventCount =
        session.state === 'PRACTICE'
          ? currentStateEvents.filter(
              (event) =>
                event.eventType === 'assessment_graded' &&
                event.knowledgeNodeId === session.knowledgeNodeId,
            ).length
          : 0;

      let target: TeachingState;
      let assessmentExit: AssessmentExit | undefined;
      let exitEvidence: AssessmentEvidence | undefined;
      if (resolution.kind === 'ASSESSMENT_EXIT') {
        const mastery = await transaction.mastery.get(
          session.studentId,
          session.knowledgeNodeId,
        );
        const trustedDecision = decideTrustedAssessmentExit(
          mastery,
          session.knowledgeNodeId,
          currentStateEvents,
          policy,
        );
        assessmentExit = trustedDecision.assessmentExit;
        exitEvidence = trustedDecision.evidence;
        if (assessmentExit.decision === 'ADVANCE') {
          const recordedAt = this.now().toISOString();
          const eventId = z.uuid().parse(this.createEventId());
          const sequence = await transaction.events.allocateSequence(
            session.id,
          );
          const trustedEvent = domainLearningEventSchema.parse({
            schemaVersion: '1',
            eventId,
            idempotencyKey: key,
            studentId: session.studentId,
            sessionId: session.id,
            knowledgeNodeId: session.knowledgeNodeId,
            sequence,
            eventType: 'assessment_exit_decided',
            payload: {
              from: 'ASSESS',
              signal: command.candidateSignal,
              decision: assessmentExit.decision,
              reasons: [...assessmentExit.reasons],
              recentAccuracy: assessmentExit.recentAccuracy,
              policyVersion: policy.policyVersion,
              evidence: exitEvidence,
            },
            occurredAt: recordedAt,
            recordedAt,
            source: 'teaching_runtime',
            causationId: command.causationId,
          });
          if (trustedEvent.eventType !== 'assessment_exit_decided') {
            throw new Error('assessment_exit_decided Schema返回了错误事件类型');
          }
          const appendedEvent = await transaction.events.append(trustedEvent);
          if (appendedEvent.eventType !== 'assessment_exit_decided') {
            throw new Error('EventStore返回了错误事件类型');
          }
          return {
            ok: true,
            action: 'ADVANCE',
            replayed: false,
            event: appendedEvent,
            assessmentExit,
            session,
          };
        }
        target = policy.remediationTarget;
      } else {
        target = resolution.to;
      }

      const guard = evaluateTransition({
        from: session.state,
        to: target,
        practiceEventCount,
        minimumPracticeEvents: policy.minimumPracticeEvents,
        assessmentDecision: assessmentExit?.decision,
      });
      if (!guard.ok) return { ok: false, code: guard.code };

      const recordedAt = this.now().toISOString();
      const eventId = z.uuid().parse(this.createEventId());
      const sequence = await transaction.events.allocateSequence(session.id);
      const trustedEvent = domainLearningEventSchema.parse({
        schemaVersion: '1',
        eventId,
        idempotencyKey: key,
        studentId: session.studentId,
        sessionId: session.id,
        knowledgeNodeId: session.knowledgeNodeId,
        sequence,
        eventType: 'state_transition',
        payload: {
          from: session.state,
          to: target,
          reason: command.candidateSignal,
          policyVersion: policy.policyVersion,
          minimumPracticeEvents: policy.minimumPracticeEvents,
          practiceEventCount,
          ...(assessmentExit && exitEvidence
            ? {
                assessmentExit: {
                  decision: assessmentExit.decision,
                  reasons: [...assessmentExit.reasons],
                  recentAccuracy: assessmentExit.recentAccuracy,
                  evidence: exitEvidence,
                },
              }
            : {}),
        },
        occurredAt: recordedAt,
        recordedAt,
        source: 'teaching_runtime',
        causationId: command.causationId,
      });
      if (trustedEvent.eventType !== 'state_transition') {
        throw new Error('state_transition Schema返回了错误事件类型');
      }

      const updatedSession = await transaction.sessions.updateState({
        sessionId: session.id,
        expectedVersion: session.version,
        state: target,
        interruptedState: session.interruptedState,
      });
      const appendedEvent = await transaction.events.append(trustedEvent);
      if (appendedEvent.eventType !== 'state_transition') {
        throw new Error('EventStore返回了错误事件类型');
      }
      return {
        ok: true,
        action: 'TRANSITION',
        replayed: false,
        event: appendedEvent,
        session: updatedSession,
      };
    });
  }
}

/** 公开类型帮助组合根保持课程策略参数与领域配置一致。 */
export type { MasteryConfig, TeachingTransitionCandidateSignal };
