import { prepareArtifact } from '@educanvas/canvas-protocol/server';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ArtifactContentConflictError,
  DrizzleArtifactRepository,
  ensurePreparedArtifact,
} from './artifact-repository';
import {
  DrizzlePlatformArtifactRepository,
  ArtifactOwnershipError,
} from './platform-artifact-repository';
import * as schema from './schema';

function resolveTestDatabaseUrl() {
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
  ? postgres(testDatabaseUrl, { max: 10, onnotice: () => undefined })
  : null;
const database = connection ? drizzle(connection, { schema }) : null;

function getDatabase() {
  if (!database) throw new Error('TEST_DATABASE_URL未设置');
  return database;
}

const sessionId = '70000000-0000-4000-8000-000000000001';
const studentId = 'bridge-test-student';
const knowledgeNodeId = 'bridge-test-knowledge';
const artifactId = 'bridge-test-quiz';

const completeArtifact = {
  schemaVersion: '1',
  artifactId,
  type: 'quiz',
  title: '桥接测试小测',
  params: {
    questions: [
      {
        id: 'q1',
        question: '桥接测试题？',
        options: [
          { id: 'a', text: '选项A' },
          { id: 'b', text: '选项B' },
        ],
        correctOptionId: 'a',
      },
    ],
  },
} as const;

describeWithDatabase('K12 Artifact 平台桥接（ADR-0011）', () => {
  beforeAll(async () => {
    await migrate(getDatabase(), {
      migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
    });
  });

  beforeEach(async () => {
    await getDatabase().execute(sql`
      truncate table
        canvas_artifact_grading_keys,
        canvas_artifacts,
        artifact_versions,
        artifact_generation_jobs,
        artifacts,
        learning_events,
        mastery_states,
        conversation_messages,
        chat_messages,
        agent_message_parts,
        turn_context_snapshots,
        lesson_sessions,
        agent_operations,
        conversations,
        notebook_memberships,
        spaces,
        platform_users
      restart identity cascade
    `);
  });

  afterAll(async () => {
    await connection?.end({ timeout: 5 });
  });

  async function seedSessionWithConversation() {
    const now = new Date('2026-07-27T01:00:00.000Z');
    const [user] = await getDatabase()
      .insert(schema.platformUsers)
      .values({ id: studentId, kind: 'registered', status: 'active' })
      .returning();
    if (!user) throw new Error('User creation failed');

    const [space] = await getDatabase()
      .insert(schema.spaces)
      .values({
        ownerSubjectId: studentId,
        kind: 'course',
        title: 'bridge-test-course',
        status: 'active',
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!space) throw new Error('Space creation failed');

    await getDatabase().insert(schema.notebookMemberships).values({
      notebookId: space.id,
      userId: studentId,
      role: 'owner',
      grantedByUserId: studentId,
    });

    const [conversation] = await getDatabase()
      .insert(schema.conversations)
      .values({
        spaceId: space.id,
        ownerSubjectId: studentId,
        agentProfileId: 'k12.teacher',
        title: 'bridge-test-course',
        status: 'active',
        lastActivityAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!conversation) throw new Error('Conversation creation failed');

    await getDatabase().insert(schema.lessonSessions).values({
      id: sessionId,
      conversationId: conversation.id,
      studentId,
      gradeBand: 'middle_school',
      courseSlug: 'bridge-test-course',
      knowledgeNodeId,
      state: 'PRACTICE',
      status: 'active',
      lastActivityAt: now,
      createdAt: now,
      updatedAt: now,
    });

    return { spaceId: space.id, conversationId: conversation.id };
  }

  describe('新 K12 Artifact 同时产生长期身份与不可变快照', () => {
    it('bootstrap 后 canvas_artifact 拥有平台关联', async () => {
      await seedSessionWithConversation();
      const prepared = prepareArtifact(completeArtifact);

      await getDatabase().transaction((tx) =>
        ensurePreparedArtifact(tx, sessionId, prepared),
      );

      const [canvasRow] = await getDatabase()
        .select()
        .from(schema.canvasArtifacts)
        .where(
          sql`${schema.canvasArtifacts.sessionId} = ${sessionId} and ${schema.canvasArtifacts.artifactId} = ${artifactId}`,
        )
        .limit(1);
      expect(canvasRow).toBeDefined();
      expect(canvasRow!.platformArtifactId).not.toBeNull();
      expect(canvasRow!.platformArtifactVersionId).not.toBeNull();

      const [platformArtifact] = await getDatabase()
        .select()
        .from(schema.artifacts)
        .where(sql`${schema.artifacts.id} = ${canvasRow!.platformArtifactId}`)
        .limit(1);
      expect(platformArtifact).toBeDefined();
      expect(platformArtifact!.kind).toBe('quiz');
      expect(platformArtifact!.trustTier).toBe('tier1');
      expect(platformArtifact!.status).toBe('active');
      expect(platformArtifact!.latestVersion).toBe(1);
      expect(platformArtifact!.title).toBe('桥接测试小测');

      const [platformVersion] = await getDatabase()
        .select()
        .from(schema.artifactVersions)
        .where(
          sql`${schema.artifactVersions.id} = ${canvasRow!.platformArtifactVersionId}`,
        )
        .limit(1);
      expect(platformVersion).toBeDefined();
      expect(platformVersion!.version).toBe(1);
      expect(platformVersion!.generatedBy).toBe('k12:bootstrap');
      expect(platformVersion!.content).toEqual(prepared.publicArtifact.params);
    });
  });

  describe('桥接关系数据库约束', () => {
    it('拒绝半关联以及不属于目标 Artifact 的 Version', async () => {
      const { spaceId } = await seedSessionWithConversation();
      const prepared = prepareArtifact(completeArtifact);
      await getDatabase().transaction((tx) =>
        ensurePreparedArtifact(tx, sessionId, prepared),
      );
      const [canvasRow] = await getDatabase()
        .select()
        .from(schema.canvasArtifacts)
        .where(sql`${schema.canvasArtifacts.sessionId} = ${sessionId}`);

      await expect(
        getDatabase()
          .update(schema.canvasArtifacts)
          .set({ platformArtifactVersionId: null })
          .where(sql`${schema.canvasArtifacts.id} = ${canvasRow!.id}`),
      ).rejects.toMatchObject({ cause: { code: '23514' } });

      const [otherArtifact] = await getDatabase()
        .insert(schema.artifacts)
        .values({
          spaceId,
          ownerSubjectId: studentId,
          kind: 'quiz',
          trustTier: 'tier1',
          title: '另一产物',
          status: 'active',
          latestVersion: 1,
        })
        .returning();
      const [otherVersion] = await getDatabase()
        .insert(schema.artifactVersions)
        .values({
          artifactId: otherArtifact!.id,
          version: 1,
          content: {},
          generatedBy: 'test',
        })
        .returning();

      await expect(
        getDatabase()
          .update(schema.canvasArtifacts)
          .set({ platformArtifactVersionId: otherVersion!.id })
          .where(sql`${schema.canvasArtifacts.id} = ${canvasRow!.id}`),
      ).rejects.toMatchObject({ cause: { code: '23503' } });
    });
  });

  describe('重试幂等', () => {
    it('同一 sessionId + artifactId 并发 bootstrap 不重复创建平台身份', async () => {
      await seedSessionWithConversation();
      const prepared = prepareArtifact(completeArtifact);

      await Promise.all([
        getDatabase().transaction((tx) =>
          ensurePreparedArtifact(tx, sessionId, prepared),
        ),
        getDatabase().transaction((tx) =>
          ensurePreparedArtifact(tx, sessionId, prepared),
        ),
      ]);

      const canvasRows = await getDatabase()
        .select()
        .from(schema.canvasArtifacts)
        .where(
          sql`${schema.canvasArtifacts.sessionId} = ${sessionId} and ${schema.canvasArtifacts.artifactId} = ${artifactId}`,
        );
      expect(canvasRows).toHaveLength(1);

      const platformRows = await getDatabase()
        .select()
        .from(schema.artifacts)
        .where(sql`${schema.artifacts.kind} = ${'quiz'}`);
      expect(platformRows).toHaveLength(1);
    });
  });

  describe('判分键不进入平台版本和 API', () => {
    it('平台版本 content 仅包含公开投影', async () => {
      await seedSessionWithConversation();
      const prepared = prepareArtifact(completeArtifact);

      await getDatabase().transaction((tx) =>
        ensurePreparedArtifact(tx, sessionId, prepared),
      );

      const [canvasRow] = await getDatabase()
        .select()
        .from(schema.canvasArtifacts)
        .where(
          sql`${schema.canvasArtifacts.sessionId} = ${sessionId} and ${schema.canvasArtifacts.artifactId} = ${artifactId}`,
        )
        .limit(1);

      const [platformVersion] = await getDatabase()
        .select()
        .from(schema.artifactVersions)
        .where(
          sql`${schema.artifactVersions.id} = ${canvasRow!.platformArtifactVersionId}`,
        )
        .limit(1);

      const versionContentStr = JSON.stringify(platformVersion!.content);
      expect(versionContentStr).not.toContain('correctOptionId');
      expect(versionContentStr).not.toContain('explanation');
    });

    it('判分键仍保存在 canvas_artifact_grading_keys 中', async () => {
      await seedSessionWithConversation();
      const prepared = prepareArtifact(completeArtifact);

      await getDatabase().transaction((tx) =>
        ensurePreparedArtifact(tx, sessionId, prepared),
      );

      const [gradingKey] = await getDatabase()
        .select()
        .from(schema.canvasArtifactGradingKeys)
        .innerJoin(
          schema.canvasArtifacts,
          sql`${schema.canvasArtifactGradingKeys.artifactRecordId} = ${schema.canvasArtifacts.id}`,
        )
        .where(
          sql`${schema.canvasArtifacts.sessionId} = ${sessionId} and ${schema.canvasArtifacts.artifactId} = ${artifactId}`,
        )
        .limit(1);
      expect(gradingKey).toBeDefined();
      expect(gradingKey!.canvas_artifact_grading_keys.gradingKey).toBeDefined();
    });
  });

  describe('平台 Artifact 归档不破坏历史学习回放', () => {
    it('归档平台 Artifact 后 canvas_artifact 仍可读取', async () => {
      await seedSessionWithConversation();
      const prepared = prepareArtifact(completeArtifact);

      await getDatabase().transaction((tx) =>
        ensurePreparedArtifact(tx, sessionId, prepared),
      );

      const [canvasRow] = await getDatabase()
        .select()
        .from(schema.canvasArtifacts)
        .where(
          sql`${schema.canvasArtifacts.sessionId} = ${sessionId} and ${schema.canvasArtifacts.artifactId} = ${artifactId}`,
        )
        .limit(1);

      const archivedAt = new Date('2026-07-27T01:05:00.000Z');
      await getDatabase()
        .update(schema.artifacts)
        .set({ status: 'archived', archivedAt })
        .where(sql`${schema.artifacts.id} = ${canvasRow!.platformArtifactId}`);
      const [platformArtifact] = await getDatabase()
        .select({ status: schema.artifacts.status })
        .from(schema.artifacts)
        .where(sql`${schema.artifacts.id} = ${canvasRow!.platformArtifactId}`);
      expect(platformArtifact?.status).toBe('archived');

      const readRepo = new DrizzleArtifactRepository(getDatabase());
      const publicArtifact = await readRepo.getPublicBySession(
        sessionId,
        artifactId,
      );
      expect(publicArtifact).not.toBeNull();
      expect(publicArtifact!.artifactId).toBe(artifactId);
    });
  });

  describe('Conversation 删除遵守学习会话保留边界', () => {
    it('存在 lesson_session 时拒绝删除 conversation，快照与桥接保持不变', async () => {
      const { conversationId } = await seedSessionWithConversation();
      const prepared = prepareArtifact(completeArtifact);

      await getDatabase().transaction((tx) =>
        ensurePreparedArtifact(tx, sessionId, prepared),
      );

      const [canvasRowBefore] = await getDatabase()
        .select()
        .from(schema.canvasArtifacts)
        .where(
          sql`${schema.canvasArtifacts.sessionId} = ${sessionId} and ${schema.canvasArtifacts.artifactId} = ${artifactId}`,
        )
        .limit(1);
      expect(canvasRowBefore!.platformArtifactId).not.toBeNull();

      await expect(
        getDatabase()
          .delete(schema.conversations)
          .where(sql`${schema.conversations.id} = ${conversationId}`),
      ).rejects.toMatchObject({ cause: { code: '23503' } });

      const [canvasRowAfter] = await getDatabase()
        .select()
        .from(schema.canvasArtifacts)
        .where(
          sql`${schema.canvasArtifacts.sessionId} = ${sessionId} and ${schema.canvasArtifacts.artifactId} = ${artifactId}`,
        )
        .limit(1);
      expect(canvasRowAfter).toBeDefined();
      expect(canvasRowAfter!.platformArtifactId).toBe(
        canvasRowBefore!.platformArtifactId,
      );
      expect(canvasRowAfter!.platformArtifactVersionId).toBe(
        canvasRowBefore!.platformArtifactVersionId,
      );

      const readRepo = new DrizzleArtifactRepository(getDatabase());
      const publicArtifact = await readRepo.getPublicBySession(
        sessionId,
        artifactId,
      );
      expect(publicArtifact).not.toBeNull();
      expect(publicArtifact!.artifactId).toBe(artifactId);
    });
  });

  describe('跨用户/跨 Notebook 统一 404', () => {
    it('不同 student 的 session 产生独立身份且无法跨 Notebook 读取', async () => {
      await seedSessionWithConversation();
      const otherStudentId = 'bridge-test-other-student';
      const otherSessionId = '70000000-0000-4000-8000-000000000002';

      const now = new Date('2026-07-27T02:00:00.000Z');
      await getDatabase()
        .insert(schema.platformUsers)
        .values({ id: otherStudentId, kind: 'registered', status: 'active' });
      const [otherSpace] = await getDatabase()
        .insert(schema.spaces)
        .values({
          ownerSubjectId: otherStudentId,
          kind: 'course',
          title: 'other-course',
          status: 'active',
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      await getDatabase().insert(schema.notebookMemberships).values({
        notebookId: otherSpace!.id,
        userId: otherStudentId,
        role: 'owner',
        grantedByUserId: otherStudentId,
      });
      const [otherConversation] = await getDatabase()
        .insert(schema.conversations)
        .values({
          spaceId: otherSpace!.id,
          ownerSubjectId: otherStudentId,
          agentProfileId: 'k12.teacher',
          title: 'other-course',
          status: 'active',
          lastActivityAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      await getDatabase().insert(schema.lessonSessions).values({
        id: otherSessionId,
        conversationId: otherConversation!.id,
        studentId: otherStudentId,
        gradeBand: 'middle_school',
        courseSlug: 'other-course',
        knowledgeNodeId: 'other-knowledge',
        state: 'PRACTICE',
        status: 'active',
        lastActivityAt: now,
        createdAt: now,
        updatedAt: now,
      });

      const prepared = prepareArtifact(completeArtifact);
      await getDatabase().transaction((tx) =>
        ensurePreparedArtifact(tx, sessionId, prepared),
      );
      await getDatabase().transaction((tx) =>
        ensurePreparedArtifact(tx, otherSessionId, prepared),
      );

      const platformArtifacts = await getDatabase()
        .select()
        .from(schema.artifacts)
        .where(sql`${schema.artifacts.kind} = ${'quiz'}`);
      expect(platformArtifacts).toHaveLength(2);

      const [canvas1] = await getDatabase()
        .select()
        .from(schema.canvasArtifacts)
        .where(sql`${schema.canvasArtifacts.sessionId} = ${sessionId}`)
        .limit(1);
      const [canvas2] = await getDatabase()
        .select()
        .from(schema.canvasArtifacts)
        .where(sql`${schema.canvasArtifacts.sessionId} = ${otherSessionId}`)
        .limit(1);
      expect(canvas1!.platformArtifactId).not.toBe(canvas2!.platformArtifactId);

      const platformRepo = new DrizzlePlatformArtifactRepository(getDatabase());
      await expect(
        platformRepo.getArtifact({
          artifactId: canvas1!.platformArtifactId!,
          trustedSubjectId: otherStudentId,
        }),
      ).rejects.toBeInstanceOf(ArtifactOwnershipError);
    });
  });

  describe('旧无关联 snapshot 仍可读取', () => {
    it('platformArtifactId 为 NULL 的旧记录正常工作', async () => {
      const now = new Date('2026-07-27T03:00:00.000Z');
      await getDatabase()
        .insert(schema.platformUsers)
        .values({ id: studentId, kind: 'registered', status: 'active' });
      const [space] = await getDatabase()
        .insert(schema.spaces)
        .values({
          ownerSubjectId: studentId,
          kind: 'course',
          title: 'old-course',
          status: 'active',
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      await getDatabase().insert(schema.notebookMemberships).values({
        notebookId: space!.id,
        userId: studentId,
        role: 'owner',
        grantedByUserId: studentId,
      });
      const [conversation] = await getDatabase()
        .insert(schema.conversations)
        .values({
          spaceId: space!.id,
          ownerSubjectId: studentId,
          agentProfileId: 'k12.teacher',
          title: 'old-course',
          status: 'active',
          lastActivityAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      const oldSessionId = '70000000-0000-4000-8000-000000000003';
      await getDatabase().insert(schema.lessonSessions).values({
        id: oldSessionId,
        conversationId: conversation!.id,
        studentId,
        gradeBand: 'middle_school',
        courseSlug: 'old-course',
        knowledgeNodeId: 'old-knowledge',
        state: 'PRACTICE',
        status: 'active',
        lastActivityAt: now,
        createdAt: now,
        updatedAt: now,
      });

      await getDatabase()
        .insert(schema.canvasArtifacts)
        .values({
          sessionId: oldSessionId,
          artifactId: 'old-quiz',
          type: 'quiz',
          schemaVersion: '1',
          title: '旧测验',
          params: prepareArtifact(completeArtifact).publicArtifact.params,
        });

      const readRepo = new DrizzleArtifactRepository(getDatabase());
      const publicArtifact = await readRepo.getPublicBySession(
        oldSessionId,
        'old-quiz',
      );
      expect(publicArtifact).not.toBeNull();

      const [legacyRow] = await getDatabase()
        .select()
        .from(schema.canvasArtifacts)
        .where(sql`${schema.canvasArtifacts.sessionId} = ${oldSessionId}`);
      expect(legacyRow!.platformArtifactId).toBeNull();
      expect(legacyRow!.platformArtifactVersionId).toBeNull();
    });
  });
});
