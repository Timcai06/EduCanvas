import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe } from 'vitest';
import { DrizzlePlatformConversationRepository } from './conversation-platform-repository';
import { DrizzleLearningSessionRepository } from './learning-session-repository';
import * as schema from './schema';

function resolveTestDatabaseUrl() {
  const value = process.env.TEST_DATABASE_URL;
  if (!value) return undefined;
  const databaseName = decodeURIComponent(new URL(value).pathname.slice(1));
  if (
    !databaseName.endsWith('_integration') &&
    !databaseName.endsWith('_test')
  ) {
    throw new Error('集成测试拒绝使用非隔离数据库');
  }
  return value;
}

export function createUnifiedMessageHistoryFixture() {
  const testDatabaseUrl = resolveTestDatabaseUrl();
  const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;
  const connection = testDatabaseUrl
    ? postgres(testDatabaseUrl, { max: 10, onnotice: () => undefined })
    : null;
  const database = connection ? drizzle(connection, { schema }) : null;
  const ownerUserId = 'unified-history-owner';
  const otherUserId = 'unified-history-other';
  const studentId = 'unified-history-student';

  function getDatabase() {
    if (!database) throw new Error('TEST_DATABASE_URL未设置');
    return database;
  }

  function installDatabaseHooks() {
    beforeAll(async () => {
      await migrate(getDatabase(), {
        migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
      });
    });
    beforeEach(async () => {
      await getDatabase().execute(sql`
        truncate table
          security_audit_events,
          object_deletion_outbox,
          agent_message_parts,
          model_runs,
          chat_messages,
          canvas_artifact_grading_keys,
          canvas_artifacts,
          learning_events,
          mastery_states,
          lesson_sessions,
          conversation_message_citations,
          operation_sources,
          conversation_messages,
          agent_operations,
          conversations,
          spaces,
          notebook_memberships,
          personal_agents,
          platform_users,
          asset_versions,
          assets
        restart identity cascade
      `);
    });
    afterAll(async () => {
      await connection?.end({ timeout: 5 });
    });
  }

  async function seedOwnerIdentity() {
    await getDatabase()
      .insert(schema.platformUsers)
      .values({
        id: ownerUserId,
        kind: 'registered',
        createdAt: new Date('2026-07-20T00:00:00.000Z'),
      })
      .onConflictDoNothing();
    await getDatabase()
      .insert(schema.personalAgents)
      .values({
        userId: ownerUserId,
        status: 'active',
        createdAt: new Date('2026-07-20T00:00:00.000Z'),
      })
      .onConflictDoNothing();
  }

  async function seedOtherIdentity() {
    await getDatabase()
      .insert(schema.platformUsers)
      .values({
        id: otherUserId,
        kind: 'registered',
        createdAt: new Date('2026-07-20T00:00:00.000Z'),
      })
      .onConflictDoNothing();
  }

  async function createConversationWithMembership(
    userId: string,
    title?: string,
  ) {
    return new DrizzlePlatformConversationRepository(getDatabase()).create({
      ownerSubjectId: userId,
      spaceKind: 'notebook',
      spaceTitle: title ?? '测试笔记本',
      agentProfileId: 'general',
      now: new Date('2026-07-20T01:00:00.000Z'),
    });
  }

  async function createK12Session(conversationId: string) {
    const bootstrapped = await new DrizzleLearningSessionRepository(
      getDatabase(),
    ).bootstrap({
      studentId,
      gradeBand: 'middle_school',
      courseSlug: 'test-course',
      knowledgeNodeId: 'node-1',
      completeArtifact: {
        schemaVersion: '1',
        artifactId: 'unified-history-quiz',
        type: 'quiz',
        title: '测试题',
        params: {
          questions: [
            {
              id: 'q1',
              question: '问题一',
              options: [
                { id: 'a', text: '选项A' },
                { id: 'b', text: '选项B' },
              ],
              correctOptionId: 'a',
            },
          ],
        },
      },
    });
    await getDatabase()
      .update(schema.lessonSessions)
      .set({ conversationId })
      .where(eq(schema.lessonSessions.id, bootstrapped.sessionId));
    return bootstrapped.sessionId;
  }

  async function insertK12Message(
    sessionId: string,
    turnId: string,
    role: 'student' | 'assistant',
    content: string,
    status: string,
    createdAt: Date,
    overrides: Record<string, unknown> = {},
  ) {
    const [message] = await getDatabase()
      .insert(schema.chatMessages)
      .values({
        sessionId,
        turnId,
        clientMessageId: role === 'student' ? turnId : null,
        requestHash: role === 'student' ? 'a'.repeat(64) : null,
        role,
        status,
        content,
        createdAt,
        completedAt:
          status === 'completed' ||
          status === 'failed' ||
          status === 'cancelled' ||
          status === 'interrupted'
            ? createdAt
            : null,
        ...overrides,
      })
      .returning({ id: schema.chatMessages.id });
    if (!message) throw new Error('K12测试消息写入失败');
    return message.id;
  }

  async function seedK12Messages(conversationId: string) {
    const sessionId = await createK12Session(conversationId);
    const turn1Id = crypto.randomUUID();
    const turn2Id = crypto.randomUUID();
    await insertK12Message(
      sessionId,
      turn1Id,
      'student',
      'K12问题一',
      'completed',
      new Date('2026-07-20T02:00:00.000Z'),
    );
    await insertK12Message(
      sessionId,
      turn1Id,
      'assistant',
      'K12回答一',
      'completed',
      new Date('2026-07-20T02:00:01.000Z'),
    );
    await insertK12Message(
      sessionId,
      turn2Id,
      'student',
      'K12问题二',
      'completed',
      new Date('2026-07-20T03:00:00.000Z'),
    );
    await insertK12Message(
      sessionId,
      turn2Id,
      'assistant',
      'K12回答二',
      'failed',
      new Date('2026-07-20T03:00:01.000Z'),
      { failureCode: 'provider_error' },
    );
    return { sessionId, turn1Id, turn2Id };
  }

  return {
    createConversationWithMembership,
    createK12Session,
    describeWithDatabase,
    getDatabase,
    insertK12Message,
    installDatabaseHooks,
    otherUserId,
    ownerUserId,
    seedK12Messages,
    seedOtherIdentity,
    seedOwnerIdentity,
  };
}
