import { randomUUID } from 'node:crypto';
import { domainLearningEventSchema } from '@educanvas/teaching-core';
import { getDb } from './client';
import {
  DrizzleEventStore,
  DrizzleSessionRepository,
  IdempotencyConflictError,
} from './teaching-adapters';
import { StudyPlanNotFoundError } from './study-repository-contracts';

type Database = ReturnType<typeof getDb>;
type DatabaseTransaction = Parameters<
  Parameters<Database['transaction']>[0]
>[0];

interface PersistDiagnosticTransitionInput {
  trustedStudentId: string;
  sessionId: string;
  attemptId: string;
}

/**
 * 在诊断事务内提交 DIAGNOSE→EXPLAIN 事实。
 *
 * 同一 attempt 的重放会验证已有事件；若历史请求已落 Attempt 但尚未写状态事实，
 * 本函数会在重放事务内补齐。浏览器和模型均不能提供目标状态或事件内容。
 */
export async function persistDiagnosticTransition(
  transaction: DatabaseTransaction,
  input: PersistDiagnosticTransitionInput,
): Promise<void> {
  const events = new DrizzleEventStore(transaction);
  const sessions = new DrizzleSessionRepository(transaction);
  const idempotencyKey = `state:${input.sessionId}:${input.attemptId}`;
  await events.lockIdempotencyKey(idempotencyKey);
  const existing = await events.getByIdempotencyKey(idempotencyKey);
  const session = await sessions.getById(input.sessionId);
  if (!session || session.studentId !== input.trustedStudentId) {
    throw new StudyPlanNotFoundError();
  }
  if (existing) {
    if (
      existing.eventType !== 'state_transition' ||
      existing.studentId !== input.trustedStudentId ||
      existing.sessionId !== input.sessionId ||
      existing.causationId !== input.attemptId ||
      existing.payload.from !== 'DIAGNOSE' ||
      existing.payload.to !== 'EXPLAIN' ||
      existing.payload.reason !== 'DIAGNOSIS_COMPLETED'
    ) {
      throw new IdempotencyConflictError(idempotencyKey);
    }
    return;
  }
  if (session.state !== 'DIAGNOSE') {
    throw new StudyPlanNotFoundError();
  }

  const now = new Date().toISOString();
  const sequence = await events.allocateSequence(session.id);
  const event = domainLearningEventSchema.parse({
    schemaVersion: '1',
    eventId: randomUUID(),
    idempotencyKey,
    studentId: session.studentId,
    sessionId: session.id,
    knowledgeNodeId: session.knowledgeNodeId,
    sequence,
    eventType: 'state_transition',
    payload: {
      from: 'DIAGNOSE',
      to: 'EXPLAIN',
      reason: 'DIAGNOSIS_COMPLETED',
      policyVersion: 'study-diagnostic-transition-v1',
      minimumPracticeEvents: 0,
      practiceEventCount: 0,
    },
    occurredAt: now,
    recordedAt: now,
    source: 'teaching_runtime',
    causationId: input.attemptId,
  });
  await sessions.updateState({
    sessionId: session.id,
    expectedVersion: session.version,
    state: 'EXPLAIN',
    interruptedState: session.interruptedState,
  });
  await events.append(event);
}
