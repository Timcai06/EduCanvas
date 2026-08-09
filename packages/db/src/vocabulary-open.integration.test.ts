import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  assetKindSchema,
  assetOriginSchema,
  assetProcessorKindSchema,
  assetRepresentationKindSchema,
} from '@educanvas/agent-core';
import { audioConsents } from './schema/audio-consent';
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
 * D03 开放 Vocabulary 与封闭状态机分离（docs/04-data/07-D03）：
 * - open 字段：DB 接受格式合法的新扩展值（无需 Migration），非法格式仍拒绝；
 *   应用层 Registry 是合法值集合的唯一权威（新值必须先登记 Registry）。
 * - closed 字段：非法值仍被 DB CHECK 拒绝（每个封闭类别抽样）。
 */
describeWithDatabase('D03 开放 Vocabulary 与封闭状态机', () => {
  beforeAll(async () => {
    await migrate(getDatabase(), {
      migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
    });
  });

  afterAll(async () => {
    await connection?.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await getDatabase().execute(
      `truncate table
        turn_usage_budget_outcomes,
        agent_operations,
        conversations,
        asset_representations,
        asset_processing_jobs,
        asset_versions,
        assets,
        lesson_sessions,
        learner_profiles,
        knowledge_sources,
        operation_sources,
        agent_message_parts,
        chat_messages,
        notebook_memberships,
        spaces,
        platform_users,
        gateway_node_invocations,
        mcp_tool_intents,
        tool_effect_reconciliations,
        tool_effects,
        tool_calls,
        model_runs
      restart identity cascade`,
    );
  });

  /* ---------- Open：DB 接受格式合法的新扩展值（无 Migration） ---------- */

  it('assets.kind/origin 接受新扩展值（格式合法），非法格式拒绝', async () => {
    const owner = `user:${randomUUID()}`;
    await getDatabase()
      .insert(schema.platformUsers)
      .values({ id: owner, kind: 'registered', status: 'active' });
    const [space] = await getDatabase()
      .insert(schema.spaces)
      .values({
        ownerSubjectId: owner,
        kind: 'notebook',
        title: 'D03 空间',
        status: 'active',
      })
      .returning({ id: schema.spaces.id });

    // 新扩展值 'model_3d' / 'scanner_import' 格式合法 → DB 接受（无需 Migration）。
    const [asset] = await getDatabase()
      .insert(schema.assets)
      .values({
        ownerSubjectId: owner,
        spaceId: space!.id,
        scope: 'space',
        kind: 'model_3d',
        origin: 'scanner_import',
        displayName: '三维模型',
        status: 'pending',
      })
      .returning({ id: schema.assets.id });
    expect(asset!.id).toBeTruthy();

    // 非法格式（大写、空格、Unicode）仍被 DB 拒绝。
    await expect(
      getDatabase().insert(schema.assets).values({
        ownerSubjectId: owner,
        spaceId: space!.id,
        scope: 'space',
        kind: 'UPPER_CASE',
        origin: 'upload',
        displayName: '非法',
        status: 'pending',
      }),
    ).rejects.toMatchObject({ cause: { code: '23514' } });
    await expect(
      getDatabase().insert(schema.assets).values({
        ownerSubjectId: owner,
        spaceId: space!.id,
        scope: 'space',
        kind: 'with space',
        origin: 'upload',
        displayName: '非法',
        status: 'pending',
      }),
    ).rejects.toMatchObject({ cause: { code: '23514' } });
  });

  it('asset_representations.kind 与 asset_processing_jobs.kind 接受新扩展值', async () => {
    const owner = `user:${randomUUID()}`;
    await getDatabase()
      .insert(schema.platformUsers)
      .values({ id: owner, kind: 'registered', status: 'active' });
    const [space] = await getDatabase()
      .insert(schema.spaces)
      .values({
        ownerSubjectId: owner,
        kind: 'notebook',
        title: 'D03 空间',
        status: 'active',
      })
      .returning({ id: schema.spaces.id });
    const [asset] = await getDatabase()
      .insert(schema.assets)
      .values({
        ownerSubjectId: owner,
        spaceId: space!.id,
        scope: 'space',
        kind: 'audio',
        origin: 'upload',
        displayName: '音频',
        status: 'processing',
      })
      .returning({ id: schema.assets.id });
    const [version] = await getDatabase()
      .insert(schema.assetVersions)
      .values({
        assetId: asset!.id,
        kind: 'audio',
        mimeType: 'audio/wav',
        byteSize: 1024,
        contentHash: 'a'.repeat(64),
        status: 'processing',
        storageKey: `d03-${randomUUID()}`,
      })
      .returning({ id: schema.assetVersions.id });

    // 新派生 kind 'denoised' 与新处理器 kind 'denoise_audio'（格式合法）。
    await getDatabase()
      .insert(schema.assetRepresentations)
      .values({
        assetVersionId: version!.id,
        kind: 'denoised',
        mimeType: 'audio/wav',
        status: 'ready',
        derivedStorageKey: `d03/rep-${randomUUID()}`,
      });
    await getDatabase().insert(schema.assetProcessingJobs).values({
      assetVersionId: version!.id,
      kind: 'denoise_audio',
      status: 'queued',
      attempts: 0,
    });

    // 非法格式仍被拒绝。
    await expect(
      getDatabase()
        .insert(schema.assetRepresentations)
        .values({
          assetVersionId: version!.id,
          kind: 'BAD-KIND',
          mimeType: 'audio/wav',
          status: 'ready',
          derivedStorageKey: `d03/rep-${randomUUID()}`,
        }),
    ).rejects.toMatchObject({ cause: { code: '23514' } });
  });

  it('capability 接受新扩展值，非法格式仍被拒绝', async () => {
    // gateway_node_invocations.capability：新能力名 'device.audio_capture'。
    // 链：platform_users → personal_agents → pairings（userId/agentId FK）
    //     → agent_operations → invocations（operationId FK）。
    const owner = `user:${randomUUID()}`;
    await getDatabase()
      .insert(schema.platformUsers)
      .values({ id: owner, kind: 'registered', status: 'active' });
    const [space] = await getDatabase()
      .insert(schema.spaces)
      .values({
        ownerSubjectId: owner,
        kind: 'notebook',
        title: 'D03 能力空间',
        status: 'active',
      })
      .returning({ id: schema.spaces.id });
    const [conversation] = await getDatabase()
      .insert(schema.conversations)
      .values({
        spaceId: space!.id,
        ownerSubjectId: owner,
        agentProfileId: 'general',
        title: 'D03 能力会话',
        status: 'active',
      })
      .returning({ id: schema.conversations.id });
    const [agent] = await getDatabase()
      .insert(schema.personalAgents)
      .values({ userId: owner, status: 'active' })
      .returning({ id: schema.personalAgents.id });
    const [pairing] = await getDatabase()
      .insert(schema.gatewayNodePairings)
      .values({
        userId: owner,
        agentId: agent!.id,
        status: 'active',
        displayName: '节点',
        devicePublicKey: 'k'.repeat(64),
        approvedCapabilities: {
          manifestId: `m-${randomUUID()}`,
          issuedAt: new Date().toISOString(),
          capabilities: [],
        },
      })
      .returning({
        id: schema.gatewayNodePairings.id,
        nodeId: schema.gatewayNodePairings.nodeId,
      });
    const [operation] = await getDatabase()
      .insert(schema.agentOperations)
      .values({
        conversationId: conversation!.id,
        kind: 'turn',
        idempotencyKey: randomUUID(),
        traceId: randomUUID(),
        status: 'completed',
      })
      .returning({ id: schema.agentOperations.id });
    await getDatabase()
      .insert(schema.gatewayNodeInvocations)
      .values({
        requestId: `req-${randomUUID()}`,
        operationId: operation!.id,
        nodeId: pairing!.nodeId,
        capability: 'device.audio_capture',
        parameters: {},
        nonce: randomUUID(),
        status: 'pending',
        issuedAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
      });
    // 非法格式 capability 仍被拒绝。
    await expect(
      getDatabase()
        .insert(schema.gatewayNodeInvocations)
        .values({
          requestId: `req-${randomUUID()}`,
          operationId: operation!.id,
          nodeId: pairing!.nodeId,
          capability: 'NOT-A-CAPABILITY',
          parameters: {},
          nonce: randomUUID(),
          status: 'pending',
          issuedAt: new Date(),
          expiresAt: new Date(Date.now() + 60_000),
        }),
    ).rejects.toMatchObject({ cause: { code: '23514' } });
  });

  it('Registry 是合法值唯一权威：未登记的新值被应用层拒绝、登记后通过', () => {
    // agent-core assetKindSchema：当前闭集（'model_3d' 未登记 → 拒绝）。
    expect(() => assetKindSchema.parse('model_3d')).toThrow();
    expect(() => assetOriginSchema.parse('scanner_import')).toThrow();
    expect(() => assetRepresentationKindSchema.parse('denoised')).toThrow();
    expect(() => assetProcessorKindSchema.parse('denoise_audio')).toThrow();
    // 已登记值通过——新增扩展值只需登记 Registry，不产生 Migration。
    expect(assetKindSchema.parse('audio')).toBe('audio');
    expect(assetOriginSchema.parse('upload')).toBe('upload');
    expect(assetRepresentationKindSchema.parse('transcription')).toBe(
      'transcription',
    );
    expect(assetProcessorKindSchema.parse('transcribe_audio')).toBe(
      'transcribe_audio',
    );
  });

  it('学习画像闭集与 teaching-core Registry 保持一致', async () => {
    const student = `student:${randomUUID()}`;
    const preferences = {
      explanationOrder: 'example_first',
      responseDepth: 'balanced',
      guidance: 'step_by_step',
      modality: 'mixed',
      feedbackStyle: 'balanced',
    } as const;
    await getDatabase()
      .insert(schema.platformUsers)
      .values({ id: student, kind: 'registered', status: 'active' });
    await expect(
      getDatabase().insert(schema.learnerProfiles).values({
        studentId: student,
        ageBand: '13_to_15',
        defaultGradeBand: 'pre_k',
        declarationSource: 'self_declared',
        declaredByUserId: student,
        preferences,
      }),
    ).rejects.toMatchObject({ cause: { code: '23514' } });
    await expect(
      getDatabase().insert(schema.learnerProfiles).values({
        studentId: student,
        ageBand: '13_to_15',
        defaultGradeBand: 'middle_school',
        declarationSource: 'self_declared',
        declaredByUserId: student,
        preferences: {},
      }),
    ).rejects.toMatchObject({ cause: { code: '23514' } });
  });

  /* ---------- Closed：封闭状态机/安全词汇非法值仍被 DB 拒绝 ---------- */

  it('closed 类别抽样：lifecycle status / security outcome / approval risk / consent purpose / tool effect / terminal state', async () => {
    // lifecycle status：agent_operations.status
    const owner = `user:${randomUUID()}`;
    await getDatabase()
      .insert(schema.platformUsers)
      .values({ id: owner, kind: 'registered', status: 'active' });
    const [space] = await getDatabase()
      .insert(schema.spaces)
      .values({
        ownerSubjectId: owner,
        kind: 'notebook',
        title: 'closed',
        status: 'active',
      })
      .returning({ id: schema.spaces.id });
    const [conversation] = await getDatabase()
      .insert(schema.conversations)
      .values({
        spaceId: space!.id,
        ownerSubjectId: owner,
        agentProfileId: 'general',
        title: 'closed',
        status: 'active',
      })
      .returning({ id: schema.conversations.id });
    await expect(
      getDatabase().insert(schema.agentOperations).values({
        conversationId: conversation!.id,
        kind: 'turn',
        idempotencyKey: randomUUID(),
        traceId: randomUUID(),
        status: 'suspended',
      }),
    ).rejects.toMatchObject({ cause: { code: '23514' } });

    // security outcome：security_audit_events.outcome
    await expect(
      getDatabase().insert(schema.securityAuditEvents).values({
        eventType: 'auth',
        outcome: 'maybe',
        occurredAt: new Date(),
        metadata: {},
      }),
    ).rejects.toMatchObject({ cause: { code: '23514' } });

    // approval risk：gateway_approvals.risk（需要真实 operation 链）
    const [operation] = await getDatabase()
      .insert(schema.agentOperations)
      .values({
        conversationId: conversation!.id,
        kind: 'turn',
        idempotencyKey: randomUUID(),
        traceId: randomUUID(),
        status: 'running',
      })
      .returning({ id: schema.agentOperations.id });
    await expect(
      getDatabase()
        .insert(schema.gatewayApprovals)
        .values({
          id: `approval-${randomUUID()}`,
          operationId: operation!.id,
          actorUserId: owner,
          capability: 'input.file',
          risk: 'l4',
          summary: 'x',
          status: 'pending',
          requestedAt: new Date(),
          expiresAt: new Date(Date.now() + 60_000),
        }),
    ).rejects.toMatchObject({ cause: { code: '23514' } });

    // consent purpose：audio_consents.purpose
    await expect(
      getDatabase()
        .insert(audioConsents)
        .values({
          subjectUserId: owner,
          grantorUserId: owner,
          authorizationType: 'self',
          proofMethod: 'adult_self_attested',
          proofReference: `assertion:${randomUUID()}`,
          purpose: 'marketing',
          consentVersion: 'v1',
          noticeVersion: 'v1',
          grantedAt: new Date(),
          expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
        }),
    ).rejects.toMatchObject({ cause: { code: '23514' } });

    // tool read/write effect：tool_calls.effect（closed 闭集）。
    // 链：lesson_sessions → chat_messages → model_runs → tool_calls。
    const [session] = await getDatabase()
      .insert(schema.lessonSessions)
      .values({
        studentId: owner,
        gradeBand: 'middle_school',
        courseSlug: 'd03',
        state: 'EXPLAIN',
        status: 'active',
      })
      .returning({ id: schema.lessonSessions.id });
    const turnId = randomUUID();
    const [studentMessage] = await getDatabase()
      .insert(schema.chatMessages)
      .values({
        sessionId: session!.id,
        turnId,
        role: 'student',
        status: 'completed',
        content: '测试',
        clientMessageId: randomUUID(),
        requestHash: 'c'.repeat(64),
        completedAt: new Date(),
      })
      .returning({ id: schema.chatMessages.id });
    const [assistantMessage] = await getDatabase()
      .insert(schema.chatMessages)
      .values({
        sessionId: session!.id,
        turnId,
        role: 'assistant',
        status: 'completed',
        content: '回答',
        completedAt: new Date(),
      })
      .returning({ id: schema.chatMessages.id });
    const [answerRun] = await getDatabase()
      .insert(schema.modelRuns)
      .values({
        sessionId: session!.id,
        operationId: turnId,
        operationKind: 'teaching_turn',
        turnId,
        phase: 'answer',
        assistantMessageId: assistantMessage!.id,
        traceId: randomUUID(),
        taskAlias: 'agent.turn',
        modelAlias: 'primary',
        promptVersion: 'v1',
        promptHash: 'a'.repeat(64),
        provider: 'fixture',
        status: 'succeeded',
        startedAt: new Date(),
        completedAt: new Date(),
      })
      .returning({ id: schema.modelRuns.id });
    expect(studentMessage!.id).toBeTruthy();
    await expect(
      getDatabase()
        .insert(schema.toolCalls)
        .values({
          sessionId: session!.id,
          turnId,
          teachingState: 'PRACTICE',
          answerModelRunId: answerRun!.id,
          providerToolCallId: 't1',
          executionId: 'e'.repeat(64),
          requestHash: 'f'.repeat(64),
          traceId: randomUUID(),
          effect: 'execute',
          status: 'pending',
          argumentSummary: {},
        }),
    ).rejects.toMatchObject({ cause: { code: '23514' } });
    // 合法 effect 值通过（closed 闭集内）。
    await getDatabase()
      .insert(schema.toolCalls)
      .values({
        sessionId: session!.id,
        turnId,
        teachingState: 'PRACTICE',
        answerModelRunId: answerRun!.id,
        providerToolCallId: 't2',
        executionId: 'e'.repeat(63) + '2',
        requestHash: 'f'.repeat(63) + '2',
        traceId: randomUUID(),
        effect: 'read',
        status: 'pending',
        argumentSummary: {},
      });
  });

  it('terminal state：web_runtime_runs.status 非法值被拒', async () => {
    const owner = `user:${randomUUID()}`;
    await getDatabase()
      .insert(schema.platformUsers)
      .values({ id: owner, kind: 'registered', status: 'active' });
    const [space] = await getDatabase()
      .insert(schema.spaces)
      .values({
        ownerSubjectId: owner,
        kind: 'notebook',
        title: 'D03 terminal',
        status: 'active',
      })
      .returning({ id: schema.spaces.id });
    const [artifact] = await getDatabase()
      .insert(schema.artifacts)
      .values({
        ownerSubjectId: owner,
        spaceId: space!.id,
        kind: 'note',
        title: '运行产物',
        status: 'active',
        trustTier: 'tier1',
      })
      .returning({ id: schema.artifacts.id });
    // terminal state：web_runtime_runs.status 非法值被拒（runtimeId/requestId
    // 为 defaultRandom，不必显式提供；artifactId 需要真实 artifacts 行）。
    await expect(
      getDatabase()
        .insert(schema.webRuntimeRuns)
        .values({
          notebookId: space!.id,
          artifactId: artifact!.id,
          artifactVersionId: randomUUID(),
          requesterSubjectId: owner,
          bootstrapExpiresAt: new Date(Date.now() + 60_000),
          status: 'paused',
          terminalAuthority: 'client_observed',
          artifactContentHash: 'b'.repeat(64),
        }),
    ).rejects.toMatchObject({ cause: { code: '23514' } });
  });
});
