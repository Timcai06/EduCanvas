import { and, asc, eq, gt, inArray, lte } from 'drizzle-orm';
import { getDb } from './client';
import {
  ChatLifecycleError,
  validateAssistantLeaseDuration,
} from './chat-repository';
import { chatMessages, lessonSessions, modelRuns } from './schema';

type Database = ReturnType<typeof getDb>;

export interface ExpiredTurnConvergence {
  assistantMessageId: string;
  sessionId: string;
  turnId: string;
  interruptedModelRuns: number;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}

/** streaming lease 只保证死记录收敛，不伪装成可重放的 token stream。 */
export class DrizzleTurnLeaseRepository {
  constructor(private readonly providedDatabase?: Database) {}

  private get database(): Database {
    return this.providedDatabase ?? getDb();
  }

  async heartbeat(input: {
    trustedStudentId: string;
    turnId: string;
    leaseId: string;
    leaseDurationMs: number;
    now?: Date;
  }): Promise<boolean> {
    if (!isUuid(input.turnId) || !isUuid(input.leaseId)) {
      throw new ChatLifecycleError('turnId 或 leaseId 无效');
    }
    const leaseDurationMs = validateAssistantLeaseDuration(
      input.leaseDurationMs,
    );
    const now = input.now ?? new Date();
    const nextExpiry = new Date(now.getTime() + leaseDurationMs);
    return this.database.transaction(async (transaction) => {
      const [owned] = await transaction
        .select({ id: chatMessages.id })
        .from(chatMessages)
        .innerJoin(
          lessonSessions,
          eq(lessonSessions.id, chatMessages.sessionId),
        )
        .where(
          and(
            eq(chatMessages.turnId, input.turnId),
            eq(chatMessages.role, 'assistant'),
            eq(lessonSessions.studentId, input.trustedStudentId),
          ),
        )
        .limit(1);
      if (!owned) return false;
      const [updated] = await transaction
        .update(chatMessages)
        .set({ heartbeatAt: now, leaseExpiresAt: nextExpiry })
        .where(
          and(
            eq(chatMessages.id, owned.id),
            eq(chatMessages.leaseId, input.leaseId),
            inArray(chatMessages.status, ['pending', 'streaming']),
            gt(chatMessages.leaseExpiresAt, now),
          ),
        )
        .returning({ id: chatMessages.id });
      return Boolean(updated);
    });
  }

  /**
   * 批量收敛过期 Turn。行锁 + 条件更新保证与 complete/cancel/heartbeat 竞争时只有一个终态胜出。
   */
  async convergeExpired(
    input: {
      now?: Date;
      limit?: number;
    } = {},
  ): Promise<readonly ExpiredTurnConvergence[]> {
    const now = input.now ?? new Date();
    const limit = input.limit ?? 100;
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      throw new ChatLifecycleError('lease 收敛 limit 必须在1-500之间');
    }
    return this.database.transaction(async (transaction) => {
      const candidates = await transaction
        .select({
          id: chatMessages.id,
          sessionId: chatMessages.sessionId,
          turnId: chatMessages.turnId,
        })
        .from(chatMessages)
        .where(
          and(
            eq(chatMessages.role, 'assistant'),
            inArray(chatMessages.status, ['pending', 'streaming']),
            lte(chatMessages.leaseExpiresAt, now),
          ),
        )
        .orderBy(asc(chatMessages.leaseExpiresAt), asc(chatMessages.id))
        .limit(limit)
        .for('update', { skipLocked: true });

      const converged: ExpiredTurnConvergence[] = [];
      for (const candidate of candidates) {
        const [message] = await transaction
          .update(chatMessages)
          .set({
            status: 'interrupted',
            failureCode: 'lease_expired',
            completedAt: now,
            leaseId: null,
            leaseExpiresAt: null,
          })
          .where(
            and(
              eq(chatMessages.id, candidate.id),
              inArray(chatMessages.status, ['pending', 'streaming']),
              lte(chatMessages.leaseExpiresAt, now),
            ),
          )
          .returning({ id: chatMessages.id });
        if (!message) continue;
        const interruptedRuns = await transaction
          .update(modelRuns)
          .set({
            status: 'interrupted',
            errorCode: 'lease_expired',
            completedAt: now,
          })
          .where(
            and(
              eq(modelRuns.assistantMessageId, candidate.id),
              inArray(modelRuns.status, ['pending', 'running']),
            ),
          )
          .returning({ id: modelRuns.id });
        await transaction
          .update(lessonSessions)
          .set({ lastActivityAt: now, updatedAt: now })
          .where(eq(lessonSessions.id, candidate.sessionId));
        converged.push({
          assistantMessageId: candidate.id,
          sessionId: candidate.sessionId,
          turnId: candidate.turnId,
          interruptedModelRuns: interruptedRuns.length,
        });
      }
      return converged;
    });
  }
}
