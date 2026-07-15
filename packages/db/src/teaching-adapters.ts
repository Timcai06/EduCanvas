import { and, asc, eq, sql } from 'drizzle-orm';
import {
  domainLearningEventSchema,
  misconceptionTagSchema,
  teachingStateSchema,
  type DomainLearningEvent,
  type EventStore,
  type LessonSessionSnapshot,
  type MasteryRepository,
  type MasterySnapshot,
  type SaveMasteryInput,
  type SessionRepository,
  type TeachingTransaction,
  type TeachingUnitOfWork,
  type UpdateSessionStateInput,
} from '@educanvas/teaching-core';
import { getDb } from './client';
import { learningEvents, lessonSessions, masteryStates } from './schema';

type Database = ReturnType<typeof getDb>;
type DatabaseTransaction = Parameters<
  Parameters<Database['transaction']>[0]
>[0];
type DatabaseExecutor = Database | DatabaseTransaction;

/** 乐观锁失败表示调用方基于过期投影决策，必须重新读取后重试整个业务操作。 */
export class OptimisticLockError extends Error {
  constructor(entity: string) {
    super(`${entity}版本已变化，拒绝覆盖并发更新`);
    this.name = 'OptimisticLockError';
  }
}

/** 同一幂等键关联不同事件时抛出，避免把冲突请求误当成安全重试。 */
export class IdempotencyConflictError extends Error {
  constructor(idempotencyKey: string) {
    super(`幂等键${idempotencyKey}已被另一事件占用`);
    this.name = 'IdempotencyConflictError';
  }
}

function toSessionSnapshot(
  row: typeof lessonSessions.$inferSelect,
): LessonSessionSnapshot {
  return {
    id: row.id,
    studentId: row.studentId,
    knowledgeNodeId: row.knowledgeNodeId,
    state: teachingStateSchema.parse(row.state),
    interruptedState:
      row.interruptedState === null
        ? null
        : teachingStateSchema.parse(row.interruptedState),
    version: row.version,
  };
}

/** Drizzle实现的会话Repository，所有状态写入都强制检查version。 */
export class DrizzleSessionRepository implements SessionRepository {
  constructor(private readonly executor: DatabaseExecutor) {}

  async getById(sessionId: string): Promise<LessonSessionSnapshot | null> {
    const [row] = await this.executor
      .select()
      .from(lessonSessions)
      .where(eq(lessonSessions.id, sessionId))
      .limit(1);
    return row ? toSessionSnapshot(row) : null;
  }

  async updateState(
    input: UpdateSessionStateInput,
  ): Promise<LessonSessionSnapshot> {
    const state = teachingStateSchema.parse(input.state);
    const interruptedState = input.interruptedState
      ? teachingStateSchema.parse(input.interruptedState)
      : null;
    const [row] = await this.executor
      .update(lessonSessions)
      .set({
        state,
        interruptedState,
        version: sql`${lessonSessions.version} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(lessonSessions.id, input.sessionId),
          eq(lessonSessions.version, input.expectedVersion),
        ),
      )
      .returning();
    if (!row) throw new OptimisticLockError('lesson_session');
    return toSessionSnapshot(row);
  }
}

const activeMisconceptionsSchema = misconceptionTagSchema.array();

function toMasterySnapshot(
  row: typeof masteryStates.$inferSelect,
): MasterySnapshot {
  return {
    studentId: row.studentId,
    knowledgeNodeId: row.knowledgeNodeId,
    masteryScore: row.masteryScore,
    attemptCount: row.attemptCount,
    correctCount: row.correctCount,
    hintCount: row.hintCount,
    activeMisconceptions: activeMisconceptionsSchema.parse(
      row.misconceptionTags,
    ),
    lastPracticedAt: row.lastPracticedAt?.toISOString() ?? null,
    nextReviewAt: row.nextReviewAt?.toISOString() ?? null,
    version: row.version,
  };
}

/** Drizzle实现的掌握度投影Repository；新建使用expectedVersion=0，更新必须命中当前版本。 */
export class DrizzleMasteryRepository implements MasteryRepository {
  constructor(private readonly executor: DatabaseExecutor) {}

  async get(
    studentId: string,
    knowledgeNodeId: string,
  ): Promise<MasterySnapshot | null> {
    const [row] = await this.executor
      .select()
      .from(masteryStates)
      .where(
        and(
          eq(masteryStates.studentId, studentId),
          eq(masteryStates.knowledgeNodeId, knowledgeNodeId),
        ),
      )
      .limit(1);
    return row ? toMasterySnapshot(row) : null;
  }

  async save(input: SaveMasteryInput): Promise<MasterySnapshot> {
    const snapshot = input.snapshot;
    const values = {
      studentId: snapshot.studentId,
      knowledgeNodeId: snapshot.knowledgeNodeId,
      masteryScore: snapshot.masteryScore,
      attemptCount: snapshot.attemptCount,
      correctCount: snapshot.correctCount,
      hintCount: snapshot.hintCount,
      misconceptionTags: [...snapshot.activeMisconceptions],
      lastPracticedAt: snapshot.lastPracticedAt
        ? new Date(snapshot.lastPracticedAt)
        : null,
      nextReviewAt: snapshot.nextReviewAt
        ? new Date(snapshot.nextReviewAt)
        : null,
    };

    if (input.expectedVersion === 0) {
      const [created] = await this.executor
        .insert(masteryStates)
        .values({ ...values, version: 1 })
        .onConflictDoNothing()
        .returning();
      if (!created) throw new OptimisticLockError('mastery_state');
      return toMasterySnapshot(created);
    }

    const [updated] = await this.executor
      .update(masteryStates)
      .set({ ...values, version: sql`${masteryStates.version} + 1` })
      .where(
        and(
          eq(masteryStates.studentId, snapshot.studentId),
          eq(masteryStates.knowledgeNodeId, snapshot.knowledgeNodeId),
          eq(masteryStates.version, input.expectedVersion),
        ),
      )
      .returning();
    if (!updated) throw new OptimisticLockError('mastery_state');
    return toMasterySnapshot(updated);
  }
}

function toDomainEvent(
  row: typeof learningEvents.$inferSelect,
): DomainLearningEvent {
  return domainLearningEventSchema.parse({
    schemaVersion: row.schemaVersion,
    eventId: row.id,
    idempotencyKey: row.idempotencyKey,
    studentId: row.studentId,
    sessionId: row.sessionId,
    knowledgeNodeId: row.knowledgeNodeId,
    sequence: row.sequence,
    eventType: row.eventType,
    payload: row.payload,
    occurredAt: row.occurredAt.toISOString(),
    recordedAt: row.recordedAt.toISOString(),
    source: row.source,
    causationId: row.causationId,
  });
}

/** 只追加事件存储；重复幂等键只在指向同一事件时返回原事实。 */
export class DrizzleEventStore implements EventStore {
  constructor(private readonly executor: DatabaseExecutor) {}

  async lockIdempotencyKey(idempotencyKey: string): Promise<void> {
    await this.executor.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${idempotencyKey}, 0))`,
    );
  }

  async getByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<DomainLearningEvent | null> {
    const [row] = await this.executor
      .select()
      .from(learningEvents)
      .where(eq(learningEvents.idempotencyKey, idempotencyKey))
      .limit(1);
    return row ? toDomainEvent(row) : null;
  }

  async allocateSequence(sessionId: string): Promise<number> {
    const [row] = await this.executor
      .update(lessonSessions)
      .set({
        eventSequence: sql`${lessonSessions.eventSequence} + 1`,
      })
      .where(eq(lessonSessions.id, sessionId))
      .returning({ sequence: lessonSessions.eventSequence });
    if (!row) throw new Error(`lesson_session ${sessionId}不存在`);
    return row.sequence;
  }

  async append(rawEvent: DomainLearningEvent): Promise<DomainLearningEvent> {
    const event = domainLearningEventSchema.parse(rawEvent);
    const [created] = await this.executor
      .insert(learningEvents)
      .values({
        id: event.eventId,
        idempotencyKey: event.idempotencyKey,
        studentId: event.studentId,
        sessionId: event.sessionId,
        knowledgeNodeId: event.knowledgeNodeId,
        sequence: event.sequence,
        eventType: event.eventType,
        payload: event.payload,
        occurredAt: new Date(event.occurredAt),
        recordedAt: new Date(event.recordedAt),
        source: event.source,
        schemaVersion: event.schemaVersion,
        causationId: event.causationId,
      })
      .onConflictDoNothing({ target: learningEvents.idempotencyKey })
      .returning();
    if (created) return toDomainEvent(created);

    const existing = await this.getByIdempotencyKey(event.idempotencyKey);
    if (!existing || existing.eventId !== event.eventId) {
      throw new IdempotencyConflictError(event.idempotencyKey);
    }
    return existing;
  }

  async listBySession(
    sessionId: string,
  ): Promise<readonly DomainLearningEvent[]> {
    const rows = await this.executor
      .select()
      .from(learningEvents)
      .where(eq(learningEvents.sessionId, sessionId))
      .orderBy(asc(learningEvents.sequence));
    return rows.map(toDomainEvent);
  }
}

function createTeachingTransaction(
  executor: DatabaseExecutor,
): TeachingTransaction {
  return {
    sessions: new DrizzleSessionRepository(executor),
    mastery: new DrizzleMasteryRepository(executor),
    events: new DrizzleEventStore(executor),
  };
}

/** PostgreSQL事务适配器，确保投影更新与可信事件追加同时提交或同时回滚。 */
export class DrizzleTeachingUnitOfWork implements TeachingUnitOfWork {
  constructor(private readonly providedDatabase?: Database) {}

  async run<Result>(
    operation: (transaction: TeachingTransaction) => Promise<Result>,
  ): Promise<Result> {
    const database = this.providedDatabase ?? getDb();
    return database.transaction((transaction) =>
      operation(createTeachingTransaction(transaction)),
    );
  }
}
