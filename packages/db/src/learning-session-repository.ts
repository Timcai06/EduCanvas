import { prepareArtifact } from '@educanvas/canvas-protocol/server';
import {
  publicArtifactSchema,
  type PublicArtifact,
} from '@educanvas/canvas-protocol';
import { and, desc, eq, gt, gte, lt, or } from 'drizzle-orm';
import { ensurePreparedArtifact } from './artifact-repository';
import { getDb } from './client';
import { isUuid } from './internal/identifiers';
import {
  archiveActiveLearningSessionScope,
  insertActiveLearningSession,
} from './learning-session-active-lifecycle';
import { restoreArchivedSessionIfScopeVacant } from './learning-session-compensation';
import {
  learningSessionScopeCondition,
  lockLearningSessionScope,
} from './learning-session-locks';
import {
  canvasArtifacts,
  chatMessages,
  conversations,
  lessonSessions,
  masteryStates,
} from './schema';

type Database = ReturnType<typeof getDb>;

/** 匿名演示会话的服务端有效期；Cookie过期不能替代数据库侧的重放限制。 */
export const ANONYMOUS_LEARNING_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1_000;

function activeSessionCutoff(): Date {
  return new Date(Date.now() - ANONYMOUS_LEARNING_SESSION_TTL_MS);
}

/** 阶段一课程纵切的稳定范围；匿名身份只能在此范围内恢复自己的当前会话。 */
export interface LearningSessionCourseScope {
  studentId: string;
  gradeBand: string;
  courseSlug: string;
}

export interface LearningSessionScope extends LearningSessionCourseScope {
  knowledgeNodeId: string;
}

export interface BootstrapLearningSessionInput extends LearningSessionScope {
  completeArtifact: unknown;
}

export interface BootstrappedLearningSession {
  sessionId: string;
  studentId: string;
  knowledgeNodeId: string;
  artifact: PublicArtifact;
  /** 仅本次调用实际插入 Session 时为 true，供上层失败补偿判断，不能由客户端提供。 */
  created: boolean;
}

export interface OwnedLearningSession {
  sessionId: string;
  studentId: string;
  knowledgeNodeId: string;
}

export interface OwnedLearningGatewayTarget extends OwnedLearningSession {
  conversationId: string;
  notebookId: string;
}

export interface LearningSessionSummary extends OwnedLearningSession {
  status: 'active' | 'archived';
  title: string | null;
  lastActivityAt: string;
  archivedAt: string | null;
  createdAt: string;
  hasInterruptedTurn: boolean;
}

export interface LearningSessionListCursor {
  lastActivityAt: string;
  id: string;
}

export interface LearningSessionListPage {
  sessions: readonly LearningSessionSummary[];
  nextCursor: LearningSessionListCursor | null;
}

export interface LearningPageSnapshot extends OwnedLearningSession {
  artifact: PublicArtifact;
  mastery: {
    masteryScore: number;
    attemptCount: number;
    correctCount: number;
    hintCount: number;
    nextReviewAt: string | null;
  } | null;
}

/** 恢复/归档不可见的会话时统一返回，避免泄露其他学生的 session ID。 */
export class LearningSessionNotFoundError extends Error {
  readonly code = 'session_not_found';

  constructor() {
    super('学习会话不存在或不属于当前学生');
    this.name = 'LearningSessionNotFoundError';
  }
}

const scopeCondition = learningSessionScopeCondition;

function courseScopeCondition(scope: LearningSessionCourseScope) {
  return and(
    eq(lessonSessions.studentId, scope.studentId),
    eq(lessonSessions.gradeBand, scope.gradeBand),
    eq(lessonSessions.courseSlug, scope.courseSlug),
  );
}

function toSessionSummary(
  row: typeof lessonSessions.$inferSelect,
  hasInterruptedTurn = false,
): LearningSessionSummary {
  if (!row.knowledgeNodeId) {
    throw new Error('当前学习会话缺少 knowledgeNodeId');
  }
  return {
    sessionId: row.id,
    studentId: row.studentId,
    knowledgeNodeId: row.knowledgeNodeId,
    status: row.status as 'active' | 'archived',
    title: row.title,
    lastActivityAt: row.lastActivityAt.toISOString(),
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    hasInterruptedTurn,
  };
}

/**
 * 匿名学习纵切仓储。bootstrap通过事务级advisory lock保证同一学生和课程并发请求只创建一个会话，
 * 并把Session、公开Artifact与私有判分键作为一个原子提交。
 */
export class DrizzleLearningSessionRepository {
  constructor(private readonly providedDatabase?: Database) {}

  private get database(): Database {
    return this.providedDatabase ?? getDb();
  }

  async bootstrap(
    input: BootstrapLearningSessionInput,
  ): Promise<BootstrappedLearningSession> {
    const prepared = prepareArtifact(input.completeArtifact);

    return this.database.transaction(async (transaction) => {
      await lockLearningSessionScope(transaction, input);
      const [existingSession] = await transaction
        .select({ id: lessonSessions.id })
        .from(lessonSessions)
        .where(
          and(
            scopeCondition(input),
            eq(lessonSessions.status, 'active'),
            gte(lessonSessions.lastActivityAt, activeSessionCutoff()),
          ),
        )
        .orderBy(desc(lessonSessions.lastActivityAt), desc(lessonSessions.id))
        .limit(1);

      let sessionId = existingSession?.id;
      let created = false;
      if (!sessionId) {
        const now = new Date();
        // 过期 active 行仍会命中部分唯一索引，必须先显式归档再新建。
        await archiveActiveLearningSessionScope(transaction, input, now);
        sessionId = await insertActiveLearningSession(transaction, input, now);
        created = true;
      }

      await ensurePreparedArtifact(transaction, sessionId, prepared);
      return {
        sessionId,
        studentId: input.studentId,
        knowledgeNodeId: input.knowledgeNodeId,
        artifact: prepared.publicArtifact,
        created,
      };
    });
  }

  async getCurrentOwned(
    scope: LearningSessionScope,
  ): Promise<OwnedLearningSession | null> {
    const [row] = await this.database
      .select({
        sessionId: lessonSessions.id,
        studentId: lessonSessions.studentId,
        knowledgeNodeId: lessonSessions.knowledgeNodeId,
      })
      .from(lessonSessions)
      .where(
        and(
          eq(lessonSessions.studentId, scope.studentId),
          eq(lessonSessions.gradeBand, scope.gradeBand),
          eq(lessonSessions.courseSlug, scope.courseSlug),
          eq(lessonSessions.knowledgeNodeId, scope.knowledgeNodeId),
          eq(lessonSessions.status, 'active'),
          gte(lessonSessions.lastActivityAt, activeSessionCutoff()),
        ),
      )
      .orderBy(desc(lessonSessions.lastActivityAt), desc(lessonSessions.id))
      .limit(1);
    if (!row || !row.knowledgeNodeId) return null;
    return { ...row, knowledgeNodeId: row.knowledgeNodeId };
  }

  async getCurrentOwnedGatewayTarget(
    scope: LearningSessionScope,
  ): Promise<OwnedLearningGatewayTarget | null> {
    const [row] = await this.database
      .select({
        sessionId: lessonSessions.id,
        studentId: lessonSessions.studentId,
        knowledgeNodeId: lessonSessions.knowledgeNodeId,
        conversationId: lessonSessions.conversationId,
        notebookId: conversations.spaceId,
      })
      .from(lessonSessions)
      .innerJoin(
        conversations,
        eq(conversations.id, lessonSessions.conversationId),
      )
      .where(
        and(
          eq(lessonSessions.studentId, scope.studentId),
          eq(lessonSessions.gradeBand, scope.gradeBand),
          eq(lessonSessions.courseSlug, scope.courseSlug),
          eq(lessonSessions.knowledgeNodeId, scope.knowledgeNodeId),
          eq(lessonSessions.status, 'active'),
          eq(conversations.status, 'active'),
          gte(lessonSessions.lastActivityAt, activeSessionCutoff()),
        ),
      )
      .orderBy(desc(lessonSessions.lastActivityAt), desc(lessonSessions.id))
      .limit(1);
    if (!row || !row.knowledgeNodeId || !row.conversationId) return null;
    return {
      ...row,
      knowledgeNodeId: row.knowledgeNodeId,
      conversationId: row.conversationId,
    };
  }

  async getPageSnapshot(
    scope: LearningSessionScope,
    artifactId: string,
  ): Promise<LearningPageSnapshot | null> {
    const session = await this.getCurrentOwned(scope);
    if (!session) return null;

    const [artifactRow] = await this.database
      .select()
      .from(canvasArtifacts)
      .where(
        and(
          eq(canvasArtifacts.sessionId, session.sessionId),
          eq(canvasArtifacts.artifactId, artifactId),
        ),
      )
      .limit(1);
    if (!artifactRow) return null;

    const [masteryRow] = await this.database
      .select()
      .from(masteryStates)
      .where(
        and(
          eq(masteryStates.studentId, scope.studentId),
          eq(masteryStates.knowledgeNodeId, scope.knowledgeNodeId),
        ),
      )
      .limit(1);

    return {
      ...session,
      artifact: publicArtifactSchema.parse({
        schemaVersion: artifactRow.schemaVersion,
        artifactId: artifactRow.artifactId,
        type: artifactRow.type,
        title: artifactRow.title,
        params: artifactRow.params,
      }),
      mastery: masteryRow
        ? {
            masteryScore: masteryRow.masteryScore,
            attemptCount: masteryRow.attemptCount,
            correctCount: masteryRow.correctCount,
            hintCount: masteryRow.hintCount,
            nextReviewAt: masteryRow.nextReviewAt?.toISOString() ?? null,
          }
        : null,
    };
  }

  /** 显式新建学习会话：在同一事务中归档旧 active，再创建新 active。 */
  async startNew(
    input: BootstrapLearningSessionInput,
  ): Promise<BootstrappedLearningSession> {
    const prepared = prepareArtifact(input.completeArtifact);
    const now = new Date();
    return this.database.transaction(async (transaction) => {
      await lockLearningSessionScope(transaction, input);
      await archiveActiveLearningSessionScope(transaction, input, now);
      const sessionId = await insertActiveLearningSession(
        transaction,
        input,
        now,
      );
      await ensurePreparedArtifact(transaction, sessionId, prepared);
      return {
        sessionId,
        studentId: input.studentId,
        knowledgeNodeId: input.knowledgeNodeId,
        artifact: prepared.publicArtifact,
        created: true,
      };
    });
  }

  /** 显式恢复已归档的近期会话；操作不冒充消息活动，因此不改 lastActivityAt。 */
  async resume(
    scope: LearningSessionScope,
    sessionId: string,
  ): Promise<LearningSessionSummary> {
    const now = new Date();
    return this.database.transaction(async (transaction) => {
      await lockLearningSessionScope(transaction, scope);
      const [target] = await transaction
        .select()
        .from(lessonSessions)
        .where(
          and(
            eq(lessonSessions.id, sessionId),
            scopeCondition(scope),
            gte(lessonSessions.lastActivityAt, activeSessionCutoff()),
          ),
        )
        .limit(1);
      if (!target) throw new LearningSessionNotFoundError();
      if (target.status === 'active') return toSessionSummary(target);

      await archiveActiveLearningSessionScope(
        transaction,
        scope,
        now,
        sessionId,
      );
      const [resumed] = await transaction
        .update(lessonSessions)
        .set({ status: 'active', archivedAt: null, updatedAt: now })
        .where(
          and(
            eq(lessonSessions.id, sessionId),
            eq(lessonSessions.status, 'archived'),
          ),
        )
        .returning();
      if (!resumed) throw new LearningSessionNotFoundError();
      return toSessionSummary(resumed);
    });
  }

  /**
   * 失败补偿专用：仅当同一 scope 不存在任何 active Session 时恢复旧归档会话。
   *
   * 与 startNew 使用相同主体锁和 scope 锁，因此并发的新建会话一旦成功，
   * 本操作只返回 false，绝不会归档或覆盖它。操作不修改 lastActivityAt。
   */
  async restoreArchivedIfNoActiveSession(
    scope: LearningSessionScope,
    sessionId: string,
  ): Promise<boolean> {
    const outcome = await restoreArchivedSessionIfScopeVacant(
      this.database,
      scope,
      sessionId,
      activeSessionCutoff(),
    );
    if (outcome === 'target_not_found') {
      throw new LearningSessionNotFoundError();
    }
    return outcome === 'restored';
  }

  async archive(
    scope: LearningSessionScope,
    sessionId: string,
  ): Promise<LearningSessionSummary> {
    const now = new Date();
    return this.database.transaction(async (transaction) => {
      await lockLearningSessionScope(transaction, scope);
      const [existing] = await transaction
        .select()
        .from(lessonSessions)
        .where(and(eq(lessonSessions.id, sessionId), scopeCondition(scope)))
        .limit(1);
      if (!existing) throw new LearningSessionNotFoundError();
      if (existing.status === 'archived') return toSessionSummary(existing);
      const [archived] = await transaction
        .update(lessonSessions)
        .set({ status: 'archived', archivedAt: now, updatedAt: now })
        .where(
          and(
            eq(lessonSessions.id, sessionId),
            eq(lessonSessions.status, 'active'),
          ),
        )
        .returning();
      if (!archived) throw new LearningSessionNotFoundError();
      return toSessionSummary(archived);
    });
  }

  async listOwnedRecent(
    scope: LearningSessionCourseScope,
    options: {
      before?: LearningSessionListCursor | null;
      limit?: number;
    } = {},
  ): Promise<LearningSessionListPage> {
    const limit = Math.max(1, Math.min(options.limit ?? 20, 50));
    const beforeDate = options.before
      ? new Date(options.before.lastActivityAt)
      : null;
    if (beforeDate && Number.isNaN(beforeDate.getTime())) {
      throw new Error('会话列表 cursor 时间无效');
    }
    if (options.before && !isUuid(options.before.id)) {
      throw new Error('会话列表 cursor ID 无效');
    }
    const cursorCondition =
      options.before && beforeDate
        ? or(
            lt(lessonSessions.lastActivityAt, beforeDate),
            and(
              eq(lessonSessions.lastActivityAt, beforeDate),
              lt(lessonSessions.id, options.before.id),
            ),
          )
        : undefined;
    const interruptedSessions = this.database
      .select({ sessionId: chatMessages.sessionId })
      .from(chatMessages)
      .where(
        and(
          eq(chatMessages.role, 'assistant'),
          eq(chatMessages.status, 'interrupted'),
        ),
      )
      .groupBy(chatMessages.sessionId)
      .as('interrupted_sessions');
    const rows = await this.database
      .select({
        id: lessonSessions.id,
        conversationId: lessonSessions.conversationId,
        studentId: lessonSessions.studentId,
        gradeBand: lessonSessions.gradeBand,
        courseSlug: lessonSessions.courseSlug,
        knowledgeNodeId: lessonSessions.knowledgeNodeId,
        state: lessonSessions.state,
        interruptedState: lessonSessions.interruptedState,
        status: lessonSessions.status,
        title: lessonSessions.title,
        lastActivityAt: lessonSessions.lastActivityAt,
        archivedAt: lessonSessions.archivedAt,
        eventSequence: lessonSessions.eventSequence,
        version: lessonSessions.version,
        createdAt: lessonSessions.createdAt,
        updatedAt: lessonSessions.updatedAt,
        interruptedSessionId: interruptedSessions.sessionId,
      })
      .from(lessonSessions)
      .leftJoin(
        interruptedSessions,
        eq(interruptedSessions.sessionId, lessonSessions.id),
      )
      .where(
        and(
          courseScopeCondition(scope),
          gte(lessonSessions.lastActivityAt, activeSessionCutoff()),
          cursorCondition,
        ),
      )
      .orderBy(desc(lessonSessions.lastActivityAt), desc(lessonSessions.id))
      .limit(limit + 1);
    const hasNext = rows.length > limit;
    const pageRows = rows.slice(0, limit);
    const last = pageRows.at(-1);
    return {
      sessions: pageRows.map((row) =>
        toSessionSummary(row, row.interruptedSessionId !== null),
      ),
      nextCursor:
        hasNext && last
          ? { lastActivityAt: last.lastActivityAt.toISOString(), id: last.id }
          : null,
    };
  }
}
