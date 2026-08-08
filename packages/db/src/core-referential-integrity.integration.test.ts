import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as schema from './schema';

function resolveTestDatabaseUrl() {
  const value = process.env.TEST_DATABASE_URL;
  if (!value) return undefined;
  const databaseName = decodeURIComponent(new URL(value).pathname.slice(1));
  if (
    !databaseName.endsWith('_integration') &&
    !databaseName.endsWith('_test')
  ) {
    throw new Error('集成测试拒绝清空非隔离数据库');
  }
  return value;
}

const testDatabaseUrl = resolveTestDatabaseUrl();
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;
const connection = testDatabaseUrl
  ? postgres(testDatabaseUrl, { max: 2 })
  : null;
const database = connection ? drizzle(connection, { schema }) : null;

function getDatabase() {
  if (!database) throw new Error('TEST_DATABASE_URL未设置');
  return database;
}

/**
 * D02 三条强 FK 的删除行为固化（docs/04-data/06-D02 §5）：
 * - assets.space_id → spaces.id restrict（Space 删除必须先走 Asset tombstone + Outbox）
 * - lesson_sessions.student_id → platform_users.id restrict（教学审计保留链，
 *   主体删除必须先走显式教学闭包；与 learning_events/audio_consents 一致）
 * - turn_usage_budget_outcomes.operation_id → agent_operations.id cascade（账本无独立生命周期）
 */
describeWithDatabase('D02 核心参照完整性删除行为', () => {
  beforeAll(async () => {
    await migrate(getDatabase(), {
      migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
    });
  });

  afterAll(async () => {
    await connection?.end();
  });

  beforeEach(async () => {
    await getDatabase().execute(
      `truncate table
        turn_usage_budget_outcomes,
        agent_operations,
        conversations,
        asset_versions,
        assets,
        lesson_sessions,
        learner_profiles,
        notebook_memberships,
        spaces,
        personal_agents,
        platform_users
      restart identity cascade`,
    );
  });

  it('spaces 删除被 assets restrict，显式资产闭包后才能继续', async () => {
    const owner = `user:${randomUUID()}`;
    const [space] = await getDatabase()
      .insert(schema.spaces)
      .values({
        ownerSubjectId: owner,
        kind: 'notebook',
        title: '删除行为测试空间',
        status: 'active',
      })
      .returning({ id: schema.spaces.id });
    const [asset] = await getDatabase()
      .insert(schema.assets)
      .values({
        ownerSubjectId: owner,
        spaceId: space!.id,
        scope: 'space',
        kind: 'document',
        origin: 'upload',
        displayName: '随空间删除的资产',
        status: 'pending',
      })
      .returning({ id: schema.assets.id });

    await expect(
      getDatabase()
        .delete(schema.spaces)
        .where(eq(schema.spaces.id, space!.id)),
    ).rejects.toThrow();

    expect(
      await getDatabase()
        .select({ id: schema.assets.id })
        .from(schema.assets)
        .where(eq(schema.assets.id, asset!.id)),
    ).toEqual([{ id: asset!.id }]);

    /* 物理删除必须由上层先完成 tombstone + Outbox；FK 只负责阻止绕过该流程。 */
    await getDatabase()
      .delete(schema.assets)
      .where(eq(schema.assets.id, asset!.id));
    await expect(
      getDatabase()
        .delete(schema.spaces)
        .where(eq(schema.spaces.id, space!.id)),
    ).resolves.toBeDefined();
  });

  it('platform_users 删除时被 lesson_sessions restrict 拒绝，画像仍随主体 cascade', async () => {
    const studentId = `student:${randomUUID()}`;
    const [user] = await getDatabase()
      .insert(schema.platformUsers)
      .values({ id: studentId, kind: 'registered', status: 'active' })
      .returning({ id: schema.platformUsers.id });
    await getDatabase()
      .insert(schema.learnerProfiles)
      .values({
        studentId,
        ageBand: '13_to_15',
        defaultGradeBand: 'middle_school',
        declarationSource: 'self_declared',
        declaredByUserId: studentId,
        preferences: {
          explanationOrder: 'example_first',
          responseDepth: 'balanced',
          guidance: 'step_by_step',
          modality: 'mixed',
          feedbackStyle: 'balanced',
        },
      });
    const [session] = await getDatabase()
      .insert(schema.lessonSessions)
      .values({
        studentId,
        gradeBand: 'middle_school',
        courseSlug: 'd02-cascade-course',
        knowledgeNodeId: 'node',
        state: 'DIAGNOSE',
        status: 'active',
      })
      .returning({ id: schema.lessonSessions.id });

    /* lesson_sessions.student_id ON DELETE restrict：教学事实是审计保留链，
       主体删除必须先走显式教学闭包（与 learning_events/audio_consents 一致）。 */
    await expect(
      getDatabase()
        .delete(schema.platformUsers)
        .where(eq(schema.platformUsers.id, user!.id)),
    ).rejects.toThrow();

    /* 显式教学闭包后，learner_profiles 仍随主体 cascade 删除。 */
    await getDatabase()
      .delete(schema.lessonSessions)
      .where(eq(schema.lessonSessions.id, session!.id));
    await getDatabase()
      .delete(schema.platformUsers)
      .where(eq(schema.platformUsers.id, user!.id));
    expect(
      await getDatabase()
        .select({ id: schema.lessonSessions.id })
        .from(schema.lessonSessions)
        .where(eq(schema.lessonSessions.id, session!.id)),
    ).toEqual([]);
    expect(
      await getDatabase()
        .select({ studentId: schema.learnerProfiles.studentId })
        .from(schema.learnerProfiles)
        .where(eq(schema.learnerProfiles.studentId, studentId)),
    ).toEqual([]);
  });

  it('agent_operations 删除时预算账本随 cascade 删除', async () => {
    const owner = `user:${randomUUID()}`;
    const [space] = await getDatabase()
      .insert(schema.spaces)
      .values({
        ownerSubjectId: owner,
        kind: 'personal',
        title: '预算删除测试空间',
        status: 'active',
      })
      .returning({ id: schema.spaces.id });
    const [conversation] = await getDatabase()
      .insert(schema.conversations)
      .values({
        spaceId: space!.id,
        ownerSubjectId: owner,
        agentProfileId: 'general',
        title: '预算删除测试会话',
        status: 'active',
      })
      .returning({ id: schema.conversations.id });
    const [operation] = await getDatabase()
      .insert(schema.agentOperations)
      .values({
        id: randomUUID(),
        conversationId: conversation!.id,
        kind: 'turn',
        idempotencyKey: randomUUID(),
        traceId: randomUUID(),
        status: 'completed',
      })
      .returning({ id: schema.agentOperations.id });
    await getDatabase().insert(schema.turnUsageBudgetOutcomes).values({
      operationId: operation!.id,
      profileId: 'd02.profile',
      estimated: false,
      estimatedCostCents: 3,
      modelCalls: 1,
      toolCalls: 0,
      toolResultsTruncated: 0,
      inputTokens: 100,
      outputTokens: 50,
      wallClockMs: 500,
    });

    await getDatabase()
      .delete(schema.agentOperations)
      .where(eq(schema.agentOperations.id, operation!.id));

    expect(
      await getDatabase()
        .select({ operationId: schema.turnUsageBudgetOutcomes.operationId })
        .from(schema.turnUsageBudgetOutcomes)
        .where(eq(schema.turnUsageBudgetOutcomes.operationId, operation!.id)),
    ).toEqual([]);
  });
});
