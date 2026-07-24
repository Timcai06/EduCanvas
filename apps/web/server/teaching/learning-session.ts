import 'server-only';

import { canvasInteractionEventSchema } from '@educanvas/canvas-protocol';
import {
  DrizzleChatRepository,
  DrizzleKnowledgeRetrievalRepository,
  DrizzleLearningSessionRepository,
  DrizzleSessionRepository,
  DrizzleStudyBootstrapCompensator,
  DrizzleStudyPlanRepository,
  getDb,
} from '@educanvas/db';
import type { LessonSessionSnapshot } from '@educanvas/teaching-core';
import type { GradeCanvasSubmissionOutcome } from '@educanvas/teaching-runtime';
import type {
  CanvasSubmissionInput,
  LearningPageDTO,
  ProgressDTO,
} from '@/features/learning/learning-contracts';
import {
  readAnonymousIdentity,
  type AnonymousIdentity,
} from '../identity/anonymous-identity';
import {
  loadOwnedStudyContext,
  type OwnedStudyContext,
} from '../study/study-service';
import { demoLesson } from './demo-lesson';
import {
  gradeCanvasSubmissionService,
  progressTeachingStateService,
} from './teaching-runtime';

const learningSessions = new DrizzleLearningSessionRepository();
const chatMessages = new DrizzleChatRepository();
const knowledgeRetrieval = new DrizzleKnowledgeRetrievalRepository();
const studyPlans = new DrizzleStudyPlanRepository();
const bootstrapCompensator = new DrizzleStudyBootstrapCompensator();

function scopeFor(identity: AnonymousIdentity, context: OwnedStudyContext) {
  return {
    studentId: identity.studentId,
    gradeBand: context.plan.goal.gradeBand,
    courseSlug: context.plan.goal.courseSlug,
    // 受信课程目录保证至少六个目标。
    knowledgeNodeId: context.course.objectives[0]!.knowledgeNodeId,
  };
}

function toProgressDTO(input: {
  knowledgeNodeId: string;
  masteryScore: number;
  attemptCount: number;
  correctCount: number;
  hintCount: number;
  nextReviewAt: string | null;
}): ProgressDTO {
  return {
    knowledgeNodeId: input.knowledgeNodeId,
    masteryPercent: Math.round(input.masteryScore * 100),
    attemptedItems: input.attemptCount,
    correctItems: input.correctCount,
    hintCount: input.hintCount,
    nextReviewAt: input.nextReviewAt,
  };
}

/**
 * 显式创建新的学习记录，并把同一可信课程与目标复制到新 Notebook。
 *
 * Session 与 Goal 分属两个事务；Goal 失败时，只将本次新 Session 交给带主体锁的
 * 补偿器。新 Notebook 确认删除后恢复旧 Session；若并发请求已绑定 Goal，则两者都不动。
 */
export async function startNewAnonymousLesson(
  identity: AnonymousIdentity,
): Promise<void> {
  const context = await loadOwnedStudyContext(identity);
  if (!context) throw new Error('活动学习计划不存在');
  const session = await learningSessions.startNew({
    ...scopeFor(identity, context),
    completeArtifact: demoLesson.artifact,
  });
  try {
    await studyPlans.bootstrap({
      trustedStudentId: identity.studentId,
      declaredByUserId: context.plan.profile.declaredByUserId,
      sessionId: session.sessionId,
      desiredOutcome: context.plan.goal.desiredOutcome,
      profile: {
        ageBand: context.plan.profile.ageBand,
        gradeBand: context.plan.profile.gradeBand,
        declarationSource: context.plan.profile.declarationSource,
        preferences: context.plan.profile.preferences,
      },
      course: context.course,
    });
  } catch (error) {
    let removed: boolean;
    try {
      removed = await bootstrapCompensator.discardUnplannedSession({
        trustedStudentId: identity.studentId,
        sessionId: session.sessionId,
      });
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        '新学习记录创建失败且新建Notebook补偿失败',
      );
    }
    if (removed) {
      try {
        await learningSessions.resume(
          scopeFor(identity, context),
          context.sessionId,
        );
      } catch (resumeError) {
        throw new AggregateError(
          [error, resumeError],
          '新学习记录创建失败且旧Notebook恢复失败',
        );
      }
    }
    throw error;
  }
}

/** 恢复操作只接受会话 ID，所有权与课程范围仍由服务端可信身份收窄。 */
export async function resumeOwnedAnonymousLesson(
  identity: AnonymousIdentity,
  sessionId: string,
): Promise<void> {
  const context = await loadOwnedStudyContext(identity);
  if (!context) throw new Error('活动学习计划不存在');
  await learningSessions.resume(scopeFor(identity, context), sessionId);
}

/** Agent runtime 只从可信 Cookie + 当前 Notebook 计划恢复完整会话游标。 */
export async function loadOwnedTeachingSession(
  identity: AnonymousIdentity,
): Promise<LessonSessionSnapshot | null> {
  const context = await loadOwnedStudyContext(identity);
  if (!context) return null;
  const owned = await learningSessions.getCurrentOwned(
    scopeFor(identity, context),
  );
  if (!owned) return null;
  const session = await new DrizzleSessionRepository(getDb()).getById(
    owned.sessionId,
  );
  if (!session || session.studentId !== identity.studentId) return null;
  return session;
}

export async function loadOwnedTeachingGatewayTarget(
  identity: AnonymousIdentity,
) {
  const context = await loadOwnedStudyContext(identity);
  if (!context) return null;
  return learningSessions.getCurrentOwnedGatewayTarget(
    scopeFor(identity, context),
  );
}

/** 页面只得到公共Artifact和公开进度，不得到session、student或判分键。 */
export async function loadLearningPageData(
  identity: AnonymousIdentity,
  context: OwnedStudyContext,
): Promise<LearningPageDTO | null> {
  const snapshot = await learningSessions.getPageSnapshot(
    scopeFor(identity, context),
    demoLesson.artifact.artifactId,
  );
  if (!snapshot) return null;
  const [history, recent] = await Promise.all([
    chatMessages.listHistory({
      sessionId: snapshot.sessionId,
      trustedStudentId: identity.studentId,
      limit: 100,
    }),
    learningSessions.listOwnedRecent(
      {
        studentId: identity.studentId,
        gradeBand: context.plan.goal.gradeBand,
        courseSlug: context.plan.goal.courseSlug,
      },
      { limit: 20 },
    ),
  ]);
  const clientMessageIdByTurn = new Map(
    history.messages
      .filter(
        (message): message is typeof message & { clientMessageId: string } =>
          message.role === 'student' && message.clientMessageId !== null,
      )
      .map((message) => [message.turnId, message.clientMessageId]),
  );
  const citationsByMessage = new Map(
    await Promise.all(
      history.messages
        .filter((message) => message.role === 'assistant')
        .map(async (message) => {
          const citations = await knowledgeRetrieval.listOwnedMessageCitations({
            trustedStudentId: identity.studentId,
            sessionId: snapshot.sessionId,
            turnId: message.turnId,
            assistantMessageId: message.id,
          });
          return [
            message.id,
            citations.map((citation) => {
              const pageLabel = citation.pageStart
                ? citation.pageEnd && citation.pageEnd !== citation.pageStart
                  ? ` · 第${citation.pageStart}-${citation.pageEnd}页`
                  : ` · 第${citation.pageStart}页`
                : '';
              return {
                id: citation.id,
                marker: citation.ordinal,
                sourceId: citation.sourceId,
                documentId: citation.documentId,
                chunkId: citation.chunkId,
                label: `${citation.sourceTitle}${pageLabel}`,
                pageStart: citation.pageStart,
                pageEnd: citation.pageEnd,
              };
            }),
          ] as const;
        }),
    ),
  );
  return {
    artifact: snapshot.artifact,
    progress: snapshot.mastery
      ? toProgressDTO({
          knowledgeNodeId: snapshot.knowledgeNodeId,
          ...snapshot.mastery,
        })
      : null,
    study: {
      topic: context.plan.goal.topic,
      desiredOutcome: context.plan.goal.desiredOutcome,
      objectives:
        context.plan.latestDiagnostic?.progress.map((objective) => ({
          objectiveKey: objective.objectiveKey,
          title: objective.title,
          status: objective.status,
        })) ??
        context.plan.objectives.map((objective) => ({
          objectiveKey: objective.objectiveKey,
          title: objective.title,
          status: 'not_started' as const,
        })),
      nextObjectiveKey: context.plan.latestDiagnostic?.nextObjectiveKey ?? null,
    },
    initialMessages: history.messages.map((message) => {
      const clientMessageId = clientMessageIdByTurn.get(message.turnId);
      if (!clientMessageId) {
        throw new Error('聊天消息缺少所属 Turn 的 clientMessageId');
      }
      return {
        id: message.id,
        turnId: message.turnId,
        clientMessageId,
        role: message.role,
        status: message.status,
        content: message.content,
        parts: message.parts,
        citations: citationsByMessage.get(message.id) ?? [],
        failureCode: message.failureCode,
        createdAt: message.createdAt,
        completedAt: message.completedAt,
      };
    }),
    initialSessions: recent.sessions.map((session) => ({
      id: session.sessionId,
      title: session.title ?? context.plan.goal.topic,
      courseTitle: context.plan.goal.topic,
      status: session.status,
      lastActivityAt: session.lastActivityAt,
      hasInterruptedTurn: session.hasInterruptedTurn,
    })),
    currentSessionId: snapshot.sessionId,
  };
}

export type OwnedCanvasSubmissionOutcome =
  | { authenticated: false }
  | { authenticated: true; outcome: GradeCanvasSubmissionOutcome };

/** Action没有session参数；当前会话完全由可信Cookie身份和固定课程范围恢复。 */
export async function submitOwnedCanvas(
  input: CanvasSubmissionInput,
): Promise<OwnedCanvasSubmissionOutcome> {
  const parsed = canvasInteractionEventSchema.safeParse(input);
  if (!parsed.success) {
    return {
      authenticated: true,
      outcome: { ok: false, code: 'INVALID_CLIENT_EVENT' },
    };
  }
  const identity = await readAnonymousIdentity();
  if (!identity) return { authenticated: false };
  const context = await loadOwnedStudyContext(identity);
  if (!context) return { authenticated: false };
  const session = await learningSessions.getCurrentOwned(
    scopeFor(identity, context),
  );
  if (!session) return { authenticated: false };

  const outcome = await gradeCanvasSubmissionService.execute({
    trustedStudentId: identity.studentId,
    sessionId: session.sessionId,
    clientEvent: parsed.data,
    prerequisiteScores: [],
  });
  if (outcome.ok) {
    const current = await new DrizzleSessionRepository(getDb()).getById(
      session.sessionId,
    );
    if (current?.state === 'ASSESS') {
      const progression = await progressTeachingStateService.execute({
        trustedStudentId: identity.studentId,
        sessionId: session.sessionId,
        causationId: outcome.event.eventId,
        candidateSignal: 'ASSESSMENT_COMPLETED',
      });
      if (!progression.ok) {
        throw new Error(
          `trusted_assessment_progression_failed:${progression.code}`,
        );
      }
    }
  }
  return {
    authenticated: true,
    outcome,
  };
}

export function progressFromSubmission(
  outcome: Extract<GradeCanvasSubmissionOutcome, { ok: true }>,
): ProgressDTO {
  return toProgressDTO({
    knowledgeNodeId: outcome.mastery.knowledgeNodeId,
    masteryScore: outcome.mastery.masteryScore,
    attemptCount: outcome.mastery.attemptCount,
    correctCount: outcome.mastery.correctCount,
    hintCount: outcome.mastery.hintCount,
    nextReviewAt: outcome.mastery.nextReviewAt,
  });
}
