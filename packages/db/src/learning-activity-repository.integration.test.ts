import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DrizzleLearningActivityRepository } from './learning-activity-repository';
import * as schema from './schema';

function resolveTestDatabaseUrl(): string | undefined {
  const value = process.env.TEST_DATABASE_URL;
  if (!value) return undefined;
  const databaseName = decodeURIComponent(new URL(value).pathname.slice(1));
  if (
    !databaseName.endsWith('_integration') &&
    !databaseName.endsWith('_test')
  ) {
    throw new Error(
      '集成测试数据库名必须以_integration或_test结尾，拒绝清空非测试数据库',
    );
  }
  return value;
}

const testDatabaseUrl = resolveTestDatabaseUrl();
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;
const connection = testDatabaseUrl
  ? postgres(testDatabaseUrl, { max: 4 })
  : null;
const database = connection ? drizzle(connection, { schema }) : null;

function getDatabase() {
  if (!database) throw new Error('TEST_DATABASE_URL未设置');
  return database;
}

describeWithDatabase('学习档案可信事实仓储', () => {
  beforeAll(async () => {
    await migrate(getDatabase(), {
      migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
    });
  });

  beforeEach(async () => {
    await getDatabase().execute(sql`
      truncate table learning_events, mastery_states, lesson_sessions,
        platform_users
      restart identity cascade
    `);
    // D02 FK：lesson_sessions.student_id 必须指向真实 platform_users 主体。
    await getDatabase()
      .insert(schema.platformUsers)
      .values([
        { id: 'activity-student', kind: 'registered', status: 'active' },
        { id: 'other-activity-student', kind: 'registered', status: 'active' },
      ]);
  });

  afterAll(async () => {
    await connection?.end({ timeout: 5 });
  });

  it('只返回当前主体的判分事件、Session 数与掌握度平均值', async () => {
    const studentId = 'activity-student';
    const otherStudentId = 'other-activity-student';
    const [session, otherSession] = await getDatabase()
      .insert(schema.lessonSessions)
      .values([
        {
          studentId,
          gradeBand: 'middle_school',
          courseSlug: 'image-ai',
          state: 'PRACTICE',
        },
        {
          studentId: otherStudentId,
          gradeBand: 'middle_school',
          courseSlug: 'image-ai',
          state: 'PRACTICE',
        },
      ])
      .returning({ id: schema.lessonSessions.id });
    const gradedAt = new Date('2026-07-24T08:00:00.000Z');

    await getDatabase()
      .insert(schema.learningEvents)
      .values([
        {
          id: randomUUID(),
          idempotencyKey: 'activity-graded',
          studentId,
          sessionId: session!.id,
          knowledgeNodeId: 'node-a',
          sequence: 1,
          eventType: 'assessment_graded',
          occurredAt: gradedAt,
          recordedAt: gradedAt,
          source: 'grading_service',
          schemaVersion: '1',
          causationId: 'activity-graded',
        },
        {
          id: randomUUID(),
          idempotencyKey: 'activity-hint',
          studentId,
          sessionId: session!.id,
          knowledgeNodeId: 'node-a',
          sequence: 2,
          eventType: 'hint_recorded',
          occurredAt: new Date('2026-07-24T09:00:00.000Z'),
          recordedAt: new Date('2026-07-24T09:00:00.000Z'),
          source: 'teaching_runtime',
          schemaVersion: '1',
          causationId: 'activity-hint',
        },
        {
          id: randomUUID(),
          idempotencyKey: 'other-activity-graded',
          studentId: otherStudentId,
          sessionId: otherSession!.id,
          knowledgeNodeId: 'node-a',
          sequence: 1,
          eventType: 'assessment_graded',
          occurredAt: new Date('2026-07-24T10:00:00.000Z'),
          recordedAt: new Date('2026-07-24T10:00:00.000Z'),
          source: 'grading_service',
          schemaVersion: '1',
          causationId: 'other-activity-graded',
        },
      ]);
    await getDatabase()
      .insert(schema.masteryStates)
      .values([
        { studentId, knowledgeNodeId: 'node-a', masteryScore: 0.6 },
        { studentId, knowledgeNodeId: 'node-b', masteryScore: 0.8 },
        {
          studentId: otherStudentId,
          knowledgeNodeId: 'node-a',
          masteryScore: 0.1,
        },
      ]);

    const facts = await new DrizzleLearningActivityRepository(
      getDatabase(),
    ).getForStudent(studentId);
    expect(facts).toMatchObject({
      gradedActivityAt: [gradedAt.toISOString()],
      totalSessions: 1,
    });
    expect(facts.meanMasteryScore).toBeCloseTo(0.7);
  });
});
