import { randomUUID } from 'node:crypto';
import { eq, inArray, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ANONYMOUS_SUBJECT_RETENTION_MS,
  DrizzleAnonymousDataLifecycleService,
} from './anonymous-data-lifecycle';
import * as schema from './schema';
import {
  DrizzleTurnSafetyDecisionRepository,
  SafetyDecisionConflictError,
  SafetyDecisionOwnershipError,
} from './turn-safety-decision-repository';

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
  ? postgres(testDatabaseUrl, { max: 12 })
  : null;
const database = connection ? drizzle(connection, { schema }) : null;
const baseTime = new Date('2026-07-15T08:00:00.000Z');

function anonymousSubject(character: string): string {
  return `anon:v1:${character.repeat(64)}`;
}

function getDatabase() {
  if (!database) throw new Error('TEST_DATABASE_URL未设置');
  return database;
}

function getConnection() {
  if (!connection) throw new Error('TEST_DATABASE_URL未设置');
  return connection;
}

interface SeededGraph {
  subjectId: string;
  sessionId: string;
  turnId: string;
  artifactRecordId: string;
  knowledgeNodeId: string;
}

async function seedOwnedTurn(input: {
  subjectId: string;
  lastActivityAt: Date;
  suffix: string;
}): Promise<{ sessionId: string; turnId: string; studentMessageId: string }> {
  const db = getDatabase();
  const sessionId = randomUUID();
  const turnId = randomUUID();
  const studentMessageId = randomUUID();
  await db.insert(schema.lessonSessions).values({
    id: sessionId,
    studentId: input.subjectId,
    gradeBand: 'middle_school',
    courseSlug: `safety-${input.suffix}`,
    knowledgeNodeId: `node-${input.suffix}`,
    state: 'EXPLAIN',
    lastActivityAt: input.lastActivityAt,
    createdAt: input.lastActivityAt,
    updatedAt: input.lastActivityAt,
  });
  const completedAt = new Date(input.lastActivityAt.getTime() + 1_000);
  await db.insert(schema.chatMessages).values([
    {
      id: studentMessageId,
      sessionId,
      turnId,
      clientMessageId: `client-${input.suffix}`,
      requestHash: 'a'.repeat(64),
      role: 'student',
      status: 'completed',
      content: '测试问题',
      createdAt: input.lastActivityAt,
      completedAt,
    },
    {
      id: randomUUID(),
      sessionId,
      turnId,
      role: 'assistant',
      status: 'completed',
      content: '测试回答',
      createdAt: input.lastActivityAt,
      completedAt,
    },
  ]);
  return { sessionId, turnId, studentMessageId };
}

async function seedOwnedGraph(input: {
  subjectId: string;
  lastActivityAt: Date;
  suffix: string;
}): Promise<SeededGraph> {
  const db = getDatabase();
  const { sessionId, turnId, studentMessageId } = await seedOwnedTurn(input);
  const [asset] = await db
    .insert(schema.assets)
    .values({
      ownerSubjectId: input.subjectId,
      spaceId: sessionId,
      scope: 'space',
      kind: 'document',
      origin: 'upload',
      displayName: '测试资料.pdf',
      mimeType: 'application/pdf',
      status: 'processing',
      createdAt: input.lastActivityAt,
      updatedAt: input.lastActivityAt,
    })
    .returning({ id: schema.assets.id });
  if (!asset) throw new Error('测试Asset创建失败');
  const [version] = await db
    .insert(schema.assetVersions)
    .values({
      assetId: asset.id,
      kind: 'document',
      mimeType: 'application/pdf',
      byteSize: 128,
      contentHash: 'd'.repeat(64),
      status: 'ready',
      storageKey: `fixture/${input.suffix}.pdf`,
      extractedText: '测试资料正文',
      createdAt: input.lastActivityAt,
    })
    .returning({ id: schema.assetVersions.id });
  if (!version) throw new Error('测试Asset版本创建失败');
  await db
    .update(schema.assets)
    .set({
      status: 'ready',
      currentVersionId: version.id,
      updatedAt: input.lastActivityAt,
    })
    .where(eq(schema.assets.id, asset.id));
  await db.insert(schema.agentMessageParts).values([
    {
      messageId: studentMessageId,
      partIndex: 0,
      partType: 'text',
      textContent: '测试问题',
    },
    {
      messageId: studentMessageId,
      partIndex: 1,
      partType: 'asset_ref',
      assetId: asset.id,
      assetVersionId: version.id,
      assetUsage: 'attachment',
    },
  ]);
  const [assistant] = await db
    .select({ id: schema.chatMessages.id })
    .from(schema.chatMessages)
    .where(
      sql`${schema.chatMessages.sessionId} = ${sessionId} and ${schema.chatMessages.role} = 'assistant'`,
    )
    .limit(1);
  if (!assistant) throw new Error('测试老师消息创建失败');

  const runId = randomUUID();
  const completedAt = new Date(input.lastActivityAt.getTime() + 1_000);
  await db.insert(schema.modelRuns).values({
    id: runId,
    sessionId,
    operationId: turnId,
    operationKind: 'teaching_turn',
    assistantMessageId: assistant.id,
    turnId,
    phase: 'answer',
    traceId: `trace-${input.suffix}`,
    taskAlias: 'teaching.turn',
    modelAlias: 'primary',
    promptVersion: 'teaching-v1',
    promptHash: 'b'.repeat(64),
    status: 'succeeded',
    startedAt: input.lastActivityAt,
    completedAt,
    createdAt: input.lastActivityAt,
  });
  await db.insert(schema.toolCalls).values({
    sessionId,
    turnId,
    answerModelRunId: runId,
    providerToolCallId: `provider-call-${input.suffix}`,
    executionId: `execution-${input.suffix}`,
    requestHash: 'c'.repeat(64),
    traceId: `trace-${input.suffix}`,
    toolName: 'getStudentState',
    teachingState: 'EXPLAIN',
    exposure: 'runtime',
    effect: 'read',
    argumentSummary: { schemaVersion: '1', kind: 'object' },
    resultSummary: { schemaVersion: '1', kind: 'object' },
    status: 'succeeded',
    retryable: false,
    durationMs: 1,
    startedAt: input.lastActivityAt,
    completedAt,
    createdAt: input.lastActivityAt,
  });
  await db.insert(schema.turnSafetyDecisions).values({
    sessionId,
    turnId,
    phase: 'input',
    policyVersion: 'k12-v1',
    category: 'normal',
    action: 'allow',
    detectorVersion: 'fixture-v1',
    createdAt: input.lastActivityAt,
  });
  const [artifact] = await db
    .insert(schema.canvasArtifacts)
    .values({
      sessionId,
      artifactId: `artifact-${input.suffix}`,
      type: 'quiz',
      schemaVersion: '1',
      title: '测试Artifact',
      params: { questions: [] },
      createdAt: input.lastActivityAt,
    })
    .returning({ id: schema.canvasArtifacts.id });
  if (!artifact) throw new Error('测试Artifact创建失败');
  await db.insert(schema.canvasArtifactGradingKeys).values({
    artifactRecordId: artifact.id,
    gradingKey: { kind: 'quiz', answers: {} },
    createdAt: input.lastActivityAt,
  });
  const knowledgeNodeId = `node-${input.suffix}`;
  await db.insert(schema.learningEvents).values({
    id: randomUUID(),
    idempotencyKey: `event-${input.suffix}`,
    studentId: input.subjectId,
    sessionId,
    knowledgeNodeId,
    sequence: 1,
    eventType: 'assessment_graded',
    payload: {},
    occurredAt: input.lastActivityAt,
    recordedAt: input.lastActivityAt,
    source: 'fixture',
    schemaVersion: '1',
    causationId: `cause-${input.suffix}`,
  });
  await db.insert(schema.masteryStates).values({
    studentId: input.subjectId,
    knowledgeNodeId,
    masteryScore: 0.5,
    attemptCount: 1,
    correctCount: 1,
    hintCount: 0,
  });
  return {
    subjectId: input.subjectId,
    sessionId,
    turnId,
    artifactRecordId: artifact.id,
    knowledgeNodeId,
  };
}

async function countGraphRows(graphs: readonly SeededGraph[]) {
  const db = getDatabase();
  const sessionIds = graphs.map((graph) => graph.sessionId);
  const artifactIds = graphs.map((graph) => graph.artifactRecordId);
  const subjectId = graphs[0]?.subjectId;
  if (!subjectId || sessionIds.length === 0 || artifactIds.length === 0) {
    throw new Error('测试Graph不能为空');
  }
  const [
    toolCallCount,
    modelRunCount,
    safetyCount,
    gradingKeyCount,
    artifactCount,
    messagePartCount,
    assetVersionCount,
    assetCount,
    chatCount,
    eventCount,
    sessionCount,
    masteryCount,
  ] = await Promise.all([
    db.$count(
      schema.toolCalls,
      inArray(schema.toolCalls.sessionId, sessionIds),
    ),
    db.$count(
      schema.modelRuns,
      inArray(schema.modelRuns.sessionId, sessionIds),
    ),
    db.$count(
      schema.turnSafetyDecisions,
      inArray(schema.turnSafetyDecisions.sessionId, sessionIds),
    ),
    db.$count(
      schema.canvasArtifactGradingKeys,
      inArray(schema.canvasArtifactGradingKeys.artifactRecordId, artifactIds),
    ),
    db.$count(
      schema.canvasArtifacts,
      inArray(schema.canvasArtifacts.sessionId, sessionIds),
    ),
    db.$count(
      schema.agentMessageParts,
      inArray(
        schema.agentMessageParts.messageId,
        db
          .select({ id: schema.chatMessages.id })
          .from(schema.chatMessages)
          .where(inArray(schema.chatMessages.sessionId, sessionIds)),
      ),
    ),
    db.$count(
      schema.assetVersions,
      inArray(
        schema.assetVersions.assetId,
        db
          .select({ id: schema.assets.id })
          .from(schema.assets)
          .where(eq(schema.assets.ownerSubjectId, subjectId)),
      ),
    ),
    db.$count(schema.assets, eq(schema.assets.ownerSubjectId, subjectId)),
    db.$count(
      schema.chatMessages,
      inArray(schema.chatMessages.sessionId, sessionIds),
    ),
    db.$count(
      schema.learningEvents,
      inArray(schema.learningEvents.sessionId, sessionIds),
    ),
    db.$count(
      schema.lessonSessions,
      inArray(schema.lessonSessions.id, sessionIds),
    ),
    db.$count(
      schema.masteryStates,
      eq(schema.masteryStates.studentId, subjectId),
    ),
  ]);
  return {
    tool_calls: toolCallCount,
    model_runs: modelRunCount,
    turn_safety_decisions: safetyCount,
    canvas_artifact_grading_keys: gradingKeyCount,
    canvas_artifacts: artifactCount,
    agent_message_parts: messagePartCount,
    asset_versions: assetVersionCount,
    assets: assetCount,
    chat_messages: chatCount,
    learning_events: eventCount,
    lesson_sessions: sessionCount,
    mastery_states: masteryCount,
  };
}

describeWithDatabase('S1安全决策与匿名数据生命周期', () => {
  beforeAll(async () => {
    await migrate(getDatabase(), {
      migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
    });
    await connection?.unsafe(`
      create table if not exists lifecycle_shared_course_fixture (
        id text primary key,
        payload text not null
      )
    `);
  });

  beforeEach(async () => {
    await getDatabase().execute(sql`
      truncate table
        turn_safety_decisions,
        tool_calls,
        model_runs,
        agent_message_parts,
        chat_messages,
        asset_versions,
        assets,
        canvas_artifact_grading_keys,
        canvas_artifacts,
        learning_events,
        mastery_states,
        lesson_sessions,
        lifecycle_shared_course_fixture
      restart identity cascade
    `);
  });

  afterAll(async () => {
    await connection?.unsafe(
      'drop table if exists lifecycle_shared_course_fixture',
    );
    await connection?.end({ timeout: 5 });
  });

  it('安全决策只保存稳定分类、支持幂等重放并校验Turn归属', async () => {
    const subjectId = anonymousSubject('a');
    const { sessionId, turnId } = await seedOwnedTurn({
      subjectId,
      lastActivityAt: baseTime,
      suffix: 'safety-ledger',
    });
    const repository = new DrizzleTurnSafetyDecisionRepository(getDatabase());
    const input = {
      trustedStudentId: subjectId,
      sessionId,
      turnId,
      phase: 'input' as const,
      policyVersion: 'k12-v1',
      category: 'pii' as const,
      action: 'block' as const,
      detectorVersion: 'detector-v1',
      now: baseTime,
    };
    const recorded = await Promise.all([
      repository.record(input),
      repository.record(input),
    ]);
    expect(recorded.map((result) => result.replayed).sort()).toEqual([
      false,
      true,
    ]);
    await expect(
      repository.record({
        ...input,
        category: 'self_harm',
        action: 'escalate',
      }),
    ).resolves.toMatchObject({ replayed: false });
    await expect(
      repository.record({ ...input, category: 'normal', action: 'allow' }),
    ).rejects.toBeInstanceOf(SafetyDecisionConflictError);
    await expect(
      repository.record({ ...input, action: 'escalate' }),
    ).rejects.toBeInstanceOf(SafetyDecisionConflictError);
    await expect(
      repository.listOwnedByTurn({
        trustedStudentId: 'forged-student',
        sessionId,
        turnId,
      }),
    ).rejects.toBeInstanceOf(SafetyDecisionOwnershipError);
    await expect(
      repository.listOwnedByTurn({
        trustedStudentId: subjectId,
        sessionId,
        turnId,
      }),
    ).resolves.toHaveLength(2);

    const columns = await getConnection()<
      {
        column_name: string;
      }[]
    >`
      select column_name
      from information_schema.columns
      where table_schema = 'public' and table_name = 'turn_safety_decisions'
      order by ordinal_position
    `;
    expect(columns?.map((column) => column.column_name)).toEqual([
      'session_id',
      'turn_id',
      'phase',
      'policy_version',
      'category',
      'action',
      'detector_version',
      'created_at',
    ]);
  });

  it('安全决策严格拒绝非法值，但允许结构性normal阻断', async () => {
    const subjectId = anonymousSubject('b');
    const { sessionId, turnId } = await seedOwnedTurn({
      subjectId,
      lastActivityAt: baseTime,
      suffix: 'safety-checks',
    });
    const repository = new DrizzleTurnSafetyDecisionRepository(getDatabase());
    await expect(
      repository.record({
        trustedStudentId: subjectId,
        sessionId,
        turnId,
        phase: 'input',
        policyVersion: 'k12-v1',
        category: 'normal',
        action: 'block',
        detectorVersion: 'structural-v1',
      }),
    ).resolves.toMatchObject({ replayed: false });
    await expect(
      repository.record({
        trustedStudentId: subjectId,
        sessionId,
        turnId,
        phase: 'input',
        policyVersion: 'unsafe version',
        category: 'normal',
        action: 'allow',
        detectorVersion: 'structural-v1',
      }),
    ).rejects.toBeInstanceOf(TypeError);
    await expect(
      getDatabase().insert(schema.turnSafetyDecisions).values({
        sessionId,
        turnId: randomUUID(),
        phase: 'sideways',
        policyVersion: 'k12-v1',
        category: 'normal',
        action: 'allow',
        detectorVersion: 'structural-v1',
      }),
    ).rejects.toMatchObject({ cause: { code: '23514' } });
  });

  it('仅当整个anon:v1主体全部超过7天时逐表清零，隔离近期/边界/非匿名与共享数据', async () => {
    const oldSubject = anonymousSubject('c');
    const mixedSubject = anonymousSubject('d');
    const boundarySubject = anonymousSubject('e');
    const oldAt = new Date(
      baseTime.getTime() - ANONYMOUS_SUBJECT_RETENTION_MS - 60_000,
    );
    const recentAt = new Date(baseTime.getTime() - 60_000);
    const boundaryAt = new Date(
      baseTime.getTime() - ANONYMOUS_SUBJECT_RETENTION_MS,
    );
    const oldGraphs = await Promise.all([
      seedOwnedGraph({
        subjectId: oldSubject,
        lastActivityAt: oldAt,
        suffix: 'old-1',
      }),
      seedOwnedGraph({
        subjectId: oldSubject,
        lastActivityAt: oldAt,
        suffix: 'old-2',
      }),
    ]);
    const mixedGraphs = await Promise.all([
      seedOwnedGraph({
        subjectId: mixedSubject,
        lastActivityAt: oldAt,
        suffix: 'mixed-old',
      }),
      seedOwnedGraph({
        subjectId: mixedSubject,
        lastActivityAt: recentAt,
        suffix: 'mixed-recent',
      }),
    ]);
    const boundaryGraph = await seedOwnedGraph({
      subjectId: boundarySubject,
      lastActivityAt: boundaryAt,
      suffix: 'boundary',
    });
    const nonAnonymousGraph = await seedOwnedGraph({
      subjectId: 'registered-student-fixture',
      lastActivityAt: oldAt,
      suffix: 'non-anonymous',
    });
    await getConnection()`
      insert into lifecycle_shared_course_fixture (id, payload)
      values ('shared-course', 'must-survive')
    `;

    const lifecycle = new DrizzleAnonymousDataLifecycleService(getDatabase());
    const first = await lifecycle.purgeExpiredSubjects({ now: baseTime });
    expect(first).toMatchObject({
      evaluatedSubjects: 1,
      deletedSubjects: 1,
      skippedSubjects: 0,
      deletedRows: {
        tool_calls: 2,
        model_runs: 2,
        turn_safety_decisions: 2,
        canvas_artifact_grading_keys: 2,
        canvas_artifacts: 2,
        agent_message_parts: 4,
        asset_versions: 2,
        assets: 2,
        chat_messages: 4,
        learning_events: 2,
        lesson_sessions: 2,
        mastery_states: 2,
      },
    });
    expect(await countGraphRows(oldGraphs)).toEqual({
      tool_calls: 0,
      model_runs: 0,
      turn_safety_decisions: 0,
      canvas_artifact_grading_keys: 0,
      canvas_artifacts: 0,
      agent_message_parts: 0,
      asset_versions: 0,
      assets: 0,
      chat_messages: 0,
      learning_events: 0,
      lesson_sessions: 0,
      mastery_states: 0,
    });
    expect(await countGraphRows(mixedGraphs)).toMatchObject({
      lesson_sessions: 2,
      mastery_states: 2,
      tool_calls: 2,
    });
    expect(await countGraphRows([boundaryGraph])).toMatchObject({
      lesson_sessions: 1,
      mastery_states: 1,
    });
    expect(await countGraphRows([nonAnonymousGraph])).toMatchObject({
      lesson_sessions: 1,
      mastery_states: 1,
    });
    expect(
      await getConnection()`select * from lifecycle_shared_course_fixture`,
    ).toEqual([{ id: 'shared-course', payload: 'must-survive' }]);

    await expect(
      lifecycle.purgeExpiredSubjects({ now: baseTime }),
    ).resolves.toMatchObject({
      evaluatedSubjects: 0,
      deletedSubjects: 0,
    });
  });

  it('任一逐表清理失败时回滚整个主体，随后重跑可幂等完成', async () => {
    const subjectId = anonymousSubject('f');
    const oldAt = new Date(
      baseTime.getTime() - ANONYMOUS_SUBJECT_RETENTION_MS - 60_000,
    );
    const graph = await seedOwnedGraph({
      subjectId,
      lastActivityAt: oldAt,
      suffix: 'rollback',
    });
    const lifecycle = new DrizzleAnonymousDataLifecycleService(getDatabase());
    await expect(
      lifecycle.purgeExpiredSubjects({
        now: baseTime,
        testHooks: {
          async afterDeleteTable(tableName) {
            if (tableName === 'canvas_artifacts') {
              throw new Error('fixture transaction failure');
            }
          },
        },
      }),
    ).rejects.toThrow('fixture transaction failure');
    expect(await countGraphRows([graph])).toEqual({
      tool_calls: 1,
      model_runs: 1,
      turn_safety_decisions: 1,
      canvas_artifact_grading_keys: 1,
      canvas_artifacts: 1,
      agent_message_parts: 2,
      asset_versions: 1,
      assets: 1,
      chat_messages: 2,
      learning_events: 1,
      lesson_sessions: 1,
      mastery_states: 1,
    });

    await expect(
      lifecycle.purgeExpiredSubjects({ now: baseTime }),
    ).resolves.toMatchObject({ deletedSubjects: 1 });
    await expect(
      lifecycle.purgeExpiredSubjects({ now: baseTime }),
    ).resolves.toMatchObject({ evaluatedSubjects: 0, deletedSubjects: 0 });
    expect(await countGraphRows([graph])).toEqual({
      tool_calls: 0,
      model_runs: 0,
      turn_safety_decisions: 0,
      canvas_artifact_grading_keys: 0,
      canvas_artifacts: 0,
      agent_message_parts: 0,
      asset_versions: 0,
      assets: 0,
      chat_messages: 0,
      learning_events: 0,
      lesson_sessions: 0,
      mastery_states: 0,
    });
  });
});
