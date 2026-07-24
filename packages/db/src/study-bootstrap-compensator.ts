import { and, eq, sql } from 'drizzle-orm';
import { getDb } from './client';
import {
  canvasArtifacts,
  conversations,
  learningGoals,
  lessonSessions,
  spaces,
} from './schema';

type Database = ReturnType<typeof getDb>;

export interface DiscardUnplannedStudySessionInput {
  trustedStudentId: string;
  sessionId: string;
}

/**
 * Session 已创建而 Goal 事务失败时的窄补偿边界。
 *
 * 与 Plan bootstrap 使用同一主体锁；只有目标 Session 属于该主体且 Notebook
 * 从未产生任何 Goal 时才删除 Space，由外键级联清理 Conversation/Session/Artifact。
 * 已被并发请求成功绑定 Goal 的 Notebook 必须保留。
 */
export class DrizzleStudyBootstrapCompensator {
  constructor(private readonly providedDatabase?: Database) {}

  private get database(): Database {
    return this.providedDatabase ?? getDb();
  }

  async discardUnplannedSession(
    input: DiscardUnplannedStudySessionInput,
  ): Promise<boolean> {
    return this.database.transaction(async (transaction) => {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`study-plan:${input.trustedStudentId}`}, 0))`,
      );
      const [owned] = await transaction
        .select({
          notebookId: spaces.id,
          conversationId: conversations.id,
          goalId: learningGoals.id,
        })
        .from(lessonSessions)
        .innerJoin(
          conversations,
          eq(conversations.id, lessonSessions.conversationId),
        )
        .innerJoin(spaces, eq(spaces.id, conversations.spaceId))
        .leftJoin(learningGoals, eq(learningGoals.notebookId, spaces.id))
        .where(
          and(
            eq(lessonSessions.id, input.sessionId),
            eq(lessonSessions.studentId, input.trustedStudentId),
            eq(spaces.ownerSubjectId, input.trustedStudentId),
          ),
        )
        .limit(1);
      if (!owned || owned.goalId) return false;
      await transaction
        .delete(canvasArtifacts)
        .where(eq(canvasArtifacts.sessionId, input.sessionId));
      await transaction
        .delete(lessonSessions)
        .where(
          and(
            eq(lessonSessions.id, input.sessionId),
            eq(lessonSessions.studentId, input.trustedStudentId),
          ),
        );
      await transaction
        .delete(conversations)
        .where(
          and(
            eq(conversations.id, owned.conversationId),
            eq(conversations.ownerSubjectId, input.trustedStudentId),
          ),
        );
      const removed = await transaction
        .delete(spaces)
        .where(
          and(
            eq(spaces.id, owned.notebookId),
            eq(spaces.ownerSubjectId, input.trustedStudentId),
          ),
        )
        .returning({ id: spaces.id });
      return removed.length === 1;
    });
  }
}
