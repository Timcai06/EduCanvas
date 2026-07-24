import { and, eq, gte } from 'drizzle-orm';
import { getDb } from './client';
import {
  learningSessionScopeCondition,
  lockLearningSessionScope,
  type LearningSessionLockScope,
} from './learning-session-locks';
import { lessonSessions } from './schema';

type Database = ReturnType<typeof getDb>;

export type ConditionalSessionRestoreResult =
  'restored' | 'active_exists' | 'target_not_found';

/**
 * 在与 startNew 相同的锁内执行补偿恢复；不会归档任何 active Session。
 * 结果由公开仓储转换为 boolean 或所有权收敛后的 not-found 错误。
 */
export async function restoreArchivedSessionIfScopeVacant(
  database: Database,
  scope: LearningSessionLockScope,
  sessionId: string,
  activeSessionCutoff: Date,
): Promise<ConditionalSessionRestoreResult> {
  const now = new Date();
  return database.transaction(async (transaction) => {
    await lockLearningSessionScope(transaction, scope);
    const [target] = await transaction
      .select({ id: lessonSessions.id })
      .from(lessonSessions)
      .where(
        and(
          eq(lessonSessions.id, sessionId),
          learningSessionScopeCondition(scope),
          gte(lessonSessions.lastActivityAt, activeSessionCutoff),
        ),
      )
      .limit(1);
    if (!target) return 'target_not_found';

    const [active] = await transaction
      .select({ id: lessonSessions.id })
      .from(lessonSessions)
      .where(
        and(
          learningSessionScopeCondition(scope),
          eq(lessonSessions.status, 'active'),
        ),
      )
      .limit(1);
    if (active) return 'active_exists';

    const [restored] = await transaction
      .update(lessonSessions)
      .set({ status: 'active', archivedAt: null, updatedAt: now })
      .where(
        and(
          eq(lessonSessions.id, sessionId),
          learningSessionScopeCondition(scope),
          eq(lessonSessions.status, 'archived'),
        ),
      )
      .returning({ id: lessonSessions.id });
    return restored ? 'restored' : 'target_not_found';
  });
}
