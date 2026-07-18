import 'server-only';

import { canvasInteractionEventSchema } from '@educanvas/canvas-protocol';
import {
  DrizzleChatRepository,
  DrizzleKnowledgeRetrievalRepository,
  DrizzleLearningSessionRepository,
  DrizzleSessionRepository,
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
import { demoLesson } from './demo-lesson';
import {
  gradeCanvasSubmissionService,
  progressTeachingStateService,
} from './teaching-runtime';

const learningSessions = new DrizzleLearningSessionRepository();
const chatMessages = new DrizzleChatRepository();
const knowledgeRetrieval = new DrizzleKnowledgeRetrievalRepository();

function scopeFor(studentId: string) {
  return {
    studentId,
    gradeBand: demoLesson.gradeBand,
    courseSlug: demoLesson.courseSlug,
    knowledgeNodeId: demoLesson.knowledgeNodeId,
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

/** Cookie创建由Action负责；本函数只在数据库成功bootstrap后被调用。 */
export async function bootstrapAnonymousLesson(
  identity: AnonymousIdentity,
): Promise<void> {
  await learningSessions.bootstrap({
    ...scopeFor(identity.studentId),
    completeArtifact: demoLesson.artifact,
  });
}

/** 显式创建新的学习记录；旧 active 会话由仓储在同一事务内归档。 */
export async function startNewAnonymousLesson(
  identity: AnonymousIdentity,
): Promise<void> {
  await learningSessions.startNew({
    ...scopeFor(identity.studentId),
    completeArtifact: demoLesson.artifact,
  });
}

/** 恢复操作只接受会话 ID，所有权与课程范围仍由服务端可信身份收窄。 */
export async function resumeOwnedAnonymousLesson(
  identity: AnonymousIdentity,
  sessionId: string,
): Promise<void> {
  await learningSessions.resume(scopeFor(identity.studentId), sessionId);
}

/** 只有已经绑定当前有效会话的Cookie才允许在start Action中继续复用。 */
export async function hasActiveAnonymousLesson(
  identity: AnonymousIdentity,
): Promise<boolean> {
  return Boolean(
    await learningSessions.getCurrentOwned(scopeFor(identity.studentId)),
  );
}

/** Agent runtime 只从可信 Cookie + 固定课程范围恢复完整会话游标。 */
export async function loadOwnedTeachingSession(
  identity: AnonymousIdentity,
): Promise<LessonSessionSnapshot | null> {
  const owned = await learningSessions.getCurrentOwned(
    scopeFor(identity.studentId),
  );
  if (!owned) return null;
  const session = await new DrizzleSessionRepository(getDb()).getById(
    owned.sessionId,
  );
  if (!session || session.studentId !== identity.studentId) return null;
  return session;
}

/** 页面只得到公共Artifact和公开进度，不得到session、student或判分键。 */
export async function loadLearningPageData(): Promise<LearningPageDTO | null> {
  const identity = await readAnonymousIdentity();
  if (!identity) return null;
  const snapshot = await learningSessions.getPageSnapshot(
    scopeFor(identity.studentId),
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
        gradeBand: demoLesson.gradeBand,
        courseSlug: demoLesson.courseSlug,
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
      title: session.title ?? demoLesson.courseTitle,
      courseTitle: demoLesson.courseTitle,
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
  const session = await learningSessions.getCurrentOwned(
    scopeFor(identity.studentId),
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
