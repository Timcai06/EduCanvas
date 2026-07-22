process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

import { OPERATION_CONTINUATION_TASK } from '@educanvas/agent-core';
import {
  DrizzleAgentModelRunRepository,
  DrizzleAgentToolCallRepository,
  DrizzleGatewayIdentityRepository,
  DrizzleGatewayOperationStore,
  DrizzleMcpIntentRepository,
  DrizzleOperationContinuationRepository,
  DrizzlePlatformConversationRepository,
  DrizzlePlatformTurnRepository,
  DrizzleToolApprovalIntentRepository,
  DrizzleToolEffectRepository,
  GatewayPersistenceError,
  gatewayApprovals,
  gatewayOperationEvents,
  getDb,
  mcpToolIntents,
  notebookMemberships,
  operationContinuations,
  toolApprovalIntents,
} from '@educanvas/db';
import {
  AesGcmMcpIntentCipher,
  type McpToolRegistration,
} from '@educanvas/mcp-runtime';
import { eq, sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { runOnce } from 'graphile-worker';
import { fileURLToPath } from 'node:url';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createContinueOperationTask,
  OperationContinuationLeaseHeldError,
  type OperationContinuationResumeAdapter,
} from './tasks/continue-operation.js';
import { createMcpContinuationAdapter } from './mcp/continuation-adapter.js';

const connectionString = process.env.TEST_DATABASE_URL!;
const now = new Date('2026-07-21T15:00:00.000Z');
const mcpKey = Buffer.alloc(32, 6).toString('base64');
const mcpRegistration: McpToolRegistration & {
  risk: 'l2';
  effect: 'write';
  capability: 'external.mcp.invoke';
} = {
  serverId: 'study-tools',
  endpoint: 'http://127.0.0.1:4321/mcp',
  remoteToolName: 'publish',
  modelToolName: 'publishNotes',
  description: '发布学习笔记',
  capability: 'external.mcp.invoke',
  risk: 'l2',
  effect: 'write',
  authentication: 'none',
  inputSchema: {
    type: 'object',
    properties: { title: { type: 'string', maxLength: 100 } },
    required: ['title'],
    additionalProperties: false,
  },
  timeoutMs: 2_000,
};

async function createWaitingApproval(kind: 'node' | 'mcp' = 'node') {
  const database = getDb();
  const actorId = 'user:approval-continuation';
  const conversations = new DrizzlePlatformConversationRepository(database);
  const identities = new DrizzleGatewayIdentityRepository(database);
  const operations = new DrizzleGatewayOperationStore(database);
  const turns = new DrizzlePlatformTurnRepository(database);
  const conversation = await conversations.create({
    ownerSubjectId: actorId,
    spaceKind: 'notebook',
    spaceTitle: '审批续跑测试',
    now,
  });
  const identity = await identities.getActive(actorId);
  if (!identity) throw new Error('测试身份创建失败');
  const operation = await operations.begin({
    envelopeId: `envelope:${actorId}`,
    idempotencyKey: 'approval-continuation-message',
    requestFingerprint: 'a'.repeat(64),
    route: {
      actorUserId: actorId,
      agentId: identity.agentId,
      notebookId: conversation.spaceId,
      conversationId: conversation.id,
      membershipRole: 'owner',
    },
    now,
  });
  await operations.append(
    operation.operationId,
    { type: 'operation.accepted' },
    now,
  );
  const turn = await turns.attachGatewayTurn({
    operationId: operation.operationId,
    conversationId: conversation.id,
    trustedSubjectId: actorId,
    clientMessageId: 'approval-continuation-message',
    parts: [{ type: 'text', text: '读取受控设备资料' }],
    now,
  });
  const modelRun = await new DrizzleAgentModelRunRepository(
    database,
  ).createOrGet({
    operationId: operation.operationId,
    actorId,
    assistantMessageId: turn.assistantMessage.id,
    phase: 'answer',
    taskAlias: 'agent.turn',
    modelAlias: 'primary',
    promptVersion: 'approval-continuation-v1',
    promptHash: 'b'.repeat(64),
    now,
  });
  const toolCall = await new DrizzleAgentToolCallRepository(
    database,
  ).createOrGet({
    operationId: operation.operationId,
    actorId,
    answerModelRunId: modelRun.run.id,
    providerToolCallId: 'provider-call:approval-continuation',
    executionId: `execution:${operation.operationId}`,
    toolName: kind === 'mcp' ? 'publishNotes' : 'readAllowlistedFile',
    exposure: 'model',
    effect: kind === 'mcp' ? 'write' : 'read',
    arguments:
      kind === 'mcp' ? { title: '分数错题本' } : { path: 'notes/algebra.md' },
    now,
  });
  const approvalId = `approval:${operation.operationId}`;
  const expiresAt = new Date(now.getTime() + 10 * 60_000).toISOString();
  const continuations = new DrizzleOperationContinuationRepository(database);
  const resumeRef =
    kind === 'mcp'
      ? `mcp.intent:${'c'.repeat(64)}`
      : `node-invocation:${operation.operationId}`;
  if (kind === 'mcp') {
    const metadata = {
      resumeRef,
      operationId: operation.operationId,
      toolCallId: toolCall.call.id,
      actorId,
      agentId: identity.agentId,
      serverId: mcpRegistration.serverId,
      remoteToolName: mcpRegistration.remoteToolName,
      modelToolName: mcpRegistration.modelToolName,
      capability: mcpRegistration.capability,
      risk: mcpRegistration.risk,
      effect: mcpRegistration.effect,
      semanticsHash: AesGcmMcpIntentCipher.fromBase64(mcpKey).semanticsHash({
        registration: mcpRegistration,
        arguments: { title: '分数错题本' },
      }),
      expiresAt,
    };
    await new DrizzleMcpIntentRepository(database).prepare({
      metadata,
      sealedPayload: AesGcmMcpIntentCipher.fromBase64(mcpKey).seal({
        metadata,
        payload: {
          arguments: { title: '分数错题本' },
          credentialHandle: null,
        },
      }),
      now,
    });
  }
  await new DrizzleToolApprovalIntentRepository(database).prepare({
    operationId: operation.operationId,
    actorId,
    approvalId,
    expiresAt,
    work: {
      kind: 'tool_invocation',
      step: 'tool.invoke',
      toolCallId: toolCall.call.id,
      adapterSource: kind,
      resumeRef,
    },
    now,
  });
  await operations.append(
    operation.operationId,
    {
      type: 'approval.required',
      approval: {
        approvalId,
        operationId: operation.operationId,
        actorUserId: actorId,
        capability:
          kind === 'mcp'
            ? mcpRegistration.capability
            : 'filesystem.read_allowlisted',
        risk: 'l2',
        summary: kind === 'mcp' ? '发布学习笔记' : '读取白名单内的学习资料',
        requestedAt: now.toISOString(),
        expiresAt,
      },
    },
    now,
  );
  const waiting = await continuations.getActive({
    operationId: operation.operationId,
    actorId,
  });
  if (!waiting) throw new Error('Gateway未原子创建continuation');
  return {
    actorId,
    approvalId,
    assistantMessageId: turn.assistantMessage.id,
    conversationId: conversation.id,
    operationId: operation.operationId,
    continuationId: waiting.continuationId,
    notebookId: conversation.spaceId,
    toolCallId: toolCall.call.id,
    operations,
  };
}

describe('Gateway approval到continuation队列的原子边界', () => {
  const database = getDb();

  beforeAll(async () => {
    await migrate(database, {
      migrationsFolder: fileURLToPath(
        new URL('../../../packages/db/drizzle', import.meta.url),
      ),
    });
    await runOnce({ connectionString, taskList: { noop: async () => {} } });
  });

  beforeEach(async () => {
    await database.execute(sql`
      truncate table mcp_tool_intents, operation_continuations, tool_approval_intents, gateway_approvals,
        gateway_operation_events, tool_effects, tool_calls, model_runs,
        conversation_messages, agent_operations, conversations, spaces,
        personal_agents, platform_users
      restart identity cascade
    `);
    await database.execute(sql`delete from graphile_worker._private_jobs`);
  });

  it('把approved事件、ready游标与最小队列payload原子提交且拒绝重放', async () => {
    const fixture = await createWaitingApproval();
    const resolved = await fixture.operations.resolveApproval({
      approvalId: fixture.approvalId,
      actorUserId: fixture.actorId,
      status: 'approved',
      now: new Date(now.getTime() + 1_000),
    });
    expect(resolved).toMatchObject({
      operationId: fixture.operationId,
      continuationId: fixture.continuationId,
      decision: { status: 'approved' },
    });
    expect(
      await database
        .select({ status: operationContinuations.status })
        .from(operationContinuations)
        .where(eq(operationContinuations.id, fixture.continuationId)),
    ).toEqual([{ status: 'ready' }]);
    expect(
      await database
        .select({ status: toolApprovalIntents.status })
        .from(toolApprovalIntents)
        .where(eq(toolApprovalIntents.approvalId, fixture.approvalId)),
    ).toEqual([{ status: 'bound' }]);
    const jobs = await database.execute<{
      task_identifier: string;
      payload: unknown;
    }>(sql`
      select task.identifier as task_identifier, job.payload
      from graphile_worker._private_jobs job
      join graphile_worker._private_tasks task on task.id = job.task_id
      where task.identifier = ${OPERATION_CONTINUATION_TASK}
    `);
    expect(jobs).toEqual([
      {
        task_identifier: OPERATION_CONTINUATION_TASK,
        payload: { continuationId: fixture.continuationId },
      },
    ]);
    expect(JSON.stringify(jobs)).not.toContain('algebra.md');
    const resumed = vi.fn();
    const task = createContinueOperationTask({
      adapters: [
        {
          source: 'node',
          capabilities: ['filesystem.read_allowlisted'],
          async resume(input) {
            resumed(input.scope);
            const calls = new DrizzleAgentToolCallRepository(database);
            await calls.markRunning({
              operationId: input.scope.operationId,
              actorId: input.scope.actorId,
              toolCallId: input.continuation.work.toolCallId,
            });
            await calls.settle({
              operationId: input.scope.operationId,
              actorId: input.scope.actorId,
              toolCallId: input.continuation.work.toolCallId,
              status: 'succeeded',
              durationMs: 1,
              result: { status: 'read' },
            });
            await new DrizzlePlatformTurnRepository(database).settleTurn({
              conversationId: input.scope.conversationId,
              trustedSubjectId: input.scope.actorId,
              turnId: input.scope.operationId,
              status: 'completed',
              content: '已读取受控学习资料。',
              operationTerminalWriter: 'gateway',
            });
            return {
              status: 'completed',
              messageId: fixture.assistantMessageId,
            };
          },
        },
      ],
    });
    await runOnce({
      connectionString,
      taskList: { [OPERATION_CONTINUATION_TASK]: task },
    });
    expect(resumed).toHaveBeenCalledWith(
      expect.objectContaining({
        operationId: fixture.operationId,
        actorId: fixture.actorId,
        conversationId: fixture.conversationId,
        capability: 'filesystem.read_allowlisted',
      }),
    );
    expect(
      await database
        .select({ status: operationContinuations.status })
        .from(operationContinuations)
        .where(eq(operationContinuations.id, fixture.continuationId)),
    ).toEqual([{ status: 'completed' }]);
    await expect(
      fixture.operations.resolveApproval({
        approvalId: fixture.approvalId,
        actorUserId: fixture.actorId,
        status: 'approved',
        now: new Date(now.getTime() + 2_000),
      }),
    ).rejects.toBeInstanceOf(GatewayPersistenceError);
    expect(
      await database
        .select()
        .from(gatewayOperationEvents)
        .where(eq(gatewayOperationEvents.operationId, fixture.operationId)),
    ).toHaveLength(4);
  });

  it('MCP高风险审批后经同一continuation恢复并提交Effect，密文不进入队列或终态', async () => {
    const fixture = await createWaitingApproval('mcp');
    await fixture.operations.resolveApproval({
      approvalId: fixture.approvalId,
      actorUserId: fixture.actorId,
      status: 'approved',
      now: new Date(now.getTime() + 1_000),
    });
    const callTool = vi.fn(async () => ({
      content: [{ type: 'text', text: 'published' }],
    }));
    const task = createContinueOperationTask({
      adapters: [
        createMcpContinuationAdapter({
          registrations: [mcpRegistration],
          encryptionKey: mcpKey,
          client: { callTool },
          now: () => new Date(now.getTime() + 2_000),
          repositories: {
            intents: new DrizzleMcpIntentRepository(database),
            calls: new DrizzleAgentToolCallRepository(database),
            effects: new DrizzleToolEffectRepository(database),
            turns: new DrizzlePlatformTurnRepository(database),
          },
        }),
      ],
    });
    await runOnce({
      connectionString,
      taskList: { [OPERATION_CONTINUATION_TASK]: task },
    });

    expect(callTool).toHaveBeenCalledTimes(1);
    expect(
      await database
        .select({
          status: mcpToolIntents.status,
          ciphertext: mcpToolIntents.ciphertext,
        })
        .from(mcpToolIntents),
    ).toEqual([{ status: 'completed', ciphertext: null }]);
    expect(
      await database
        .select({ status: operationContinuations.status })
        .from(operationContinuations)
        .where(eq(operationContinuations.id, fixture.continuationId)),
    ).toEqual([{ status: 'completed' }]);
  });

  it('approved缺少等待点时回滚决策事件并保持pending', async () => {
    const fixture = await createWaitingApproval();
    await database
      .delete(operationContinuations)
      .where(eq(operationContinuations.id, fixture.continuationId));
    await expect(
      fixture.operations.resolveApproval({
        approvalId: fixture.approvalId,
        actorUserId: fixture.actorId,
        status: 'approved',
        now: new Date(now.getTime() + 1_000),
      }),
    ).rejects.toMatchObject({ code: 'invalid_event_sequence' });
    expect(
      await database
        .select({ status: gatewayApprovals.status })
        .from(gatewayApprovals)
        .where(eq(gatewayApprovals.id, fixture.approvalId)),
    ).toEqual([{ status: 'pending' }]);
    expect(
      await database
        .select()
        .from(gatewayOperationEvents)
        .where(eq(gatewayOperationEvents.operationId, fixture.operationId)),
    ).toHaveLength(2);
  });

  it('denied原子终结等待点且不创建恢复任务', async () => {
    const fixture = await createWaitingApproval();
    const resolved = await fixture.operations.resolveApproval({
      approvalId: fixture.approvalId,
      actorUserId: fixture.actorId,
      status: 'denied',
      reason: '本次不允许读取',
      now: new Date(now.getTime() + 1_000),
    });
    expect(resolved).toMatchObject({
      operationId: fixture.operationId,
      continuationId: null,
      decision: { status: 'denied' },
    });
    expect(
      await database
        .select({
          status: operationContinuations.status,
          failureCode: operationContinuations.failureCode,
        })
        .from(operationContinuations)
        .where(eq(operationContinuations.id, fixture.continuationId)),
    ).toEqual([{ status: 'failed', failureCode: 'approval_denied' }]);
    const jobs = await database.execute(sql`
      select job.id
      from graphile_worker._private_jobs job
      join graphile_worker._private_tasks task on task.id = job.task_id
      where task.identifier = ${OPERATION_CONTINUATION_TASK}
    `);
    expect(jobs).toHaveLength(0);
    const events = await fixture.operations.listEvents(
      fixture.operationId,
      -1,
      fixture.actorId,
    );
    expect(events.at(-1)).toMatchObject({
      type: 'operation.failed',
      code: 'APPROVAL_DENIED',
    });
  });

  it('取消waiting_approval时撤销待审批项并原子终结Operation', async () => {
    const fixture = await createWaitingApproval();
    await expect(
      fixture.operations.requestCancellation({
        operationId: fixture.operationId,
        actorUserId: fixture.actorId,
        now: new Date(now.getTime() + 1_000),
      }),
    ).resolves.toEqual({ recorded: true, continuation: 'cancelled' });
    expect(
      await database
        .select({
          status: gatewayApprovals.status,
          reason: gatewayApprovals.reason,
        })
        .from(gatewayApprovals)
        .where(eq(gatewayApprovals.id, fixture.approvalId)),
    ).toEqual([{ status: 'revoked', reason: 'operation_cancelled' }]);
    await expect(
      fixture.operations.resolveApproval({
        approvalId: fixture.approvalId,
        actorUserId: fixture.actorId,
        status: 'approved',
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    const events = await fixture.operations.listEvents(
      fixture.operationId,
      -1,
      fixture.actorId,
    );
    expect(events.at(-1)).toMatchObject({ type: 'operation.cancelled' });
  });

  it('Worker恢复前重新鉴权并在Membership撤销后拒绝调用Adapter', async () => {
    const fixture = await createWaitingApproval();
    await fixture.operations.resolveApproval({
      approvalId: fixture.approvalId,
      actorUserId: fixture.actorId,
      status: 'approved',
      now: new Date(now.getTime() + 1_000),
    });
    await database
      .update(notebookMemberships)
      .set({ revokedAt: new Date(now.getTime() + 2_000) })
      .where(
        sql`${notebookMemberships.notebookId} = ${fixture.notebookId} and ${notebookMemberships.userId} = ${fixture.actorId}`,
      );
    const resumed = vi.fn();
    const task = createContinueOperationTask({
      adapters: [
        {
          source: 'node',
          capabilities: ['filesystem.read_allowlisted'],
          async resume() {
            resumed();
            return {
              status: 'completed',
              messageId: fixture.assistantMessageId,
            };
          },
        },
      ],
    });
    await runOnce({
      connectionString,
      taskList: { [OPERATION_CONTINUATION_TASK]: task },
    });
    expect(resumed).not.toHaveBeenCalled();
    expect(
      await database
        .select({
          status: operationContinuations.status,
          failureCode: operationContinuations.failureCode,
        })
        .from(operationContinuations)
        .where(eq(operationContinuations.id, fixture.continuationId)),
    ).toEqual([{ status: 'failed', failureCode: 'reauthorization_failed' }]);
    const events = await fixture.operations.listEvents(
      fixture.operationId,
      -1,
      fixture.actorId,
    );
    expect(events.at(-1)).toMatchObject({
      type: 'operation.failed',
      code: 'FORBIDDEN',
      retryable: false,
    });
  });

  it('取消ready等待点时立即原子写入唯一cancelled终态', async () => {
    const fixture = await createWaitingApproval();
    await fixture.operations.resolveApproval({
      approvalId: fixture.approvalId,
      actorUserId: fixture.actorId,
      status: 'approved',
      now: new Date(now.getTime() + 1_000),
    });
    await expect(
      fixture.operations.requestCancellation({
        operationId: fixture.operationId,
        actorUserId: fixture.actorId,
        now: new Date(now.getTime() + 2_000),
      }),
    ).resolves.toEqual({ recorded: true, continuation: 'cancelled' });
    const resumed = vi.fn();
    await runOnce({
      connectionString,
      taskList: {
        [OPERATION_CONTINUATION_TASK]: createContinueOperationTask({
          adapters: [
            {
              source: 'node',
              capabilities: ['filesystem.read_allowlisted'],
              async resume() {
                resumed();
                return {
                  status: 'completed',
                  messageId: fixture.assistantMessageId,
                };
              },
            },
          ],
        }),
      },
    });
    expect(resumed).not.toHaveBeenCalled();
    expect(
      await database
        .select({ status: operationContinuations.status })
        .from(operationContinuations)
        .where(eq(operationContinuations.id, fixture.continuationId)),
    ).toEqual([{ status: 'cancelled' }]);
    const events = await fixture.operations.listEvents(
      fixture.operationId,
      -1,
      fixture.actorId,
    );
    expect(
      events.filter((event) => event.type === 'operation.cancelled'),
    ).toHaveLength(1);
  });

  it('取消与Adapter完成竞速时由持久请求赢得唯一终态', async () => {
    const fixture = await createWaitingApproval();
    await fixture.operations.resolveApproval({
      approvalId: fixture.approvalId,
      actorUserId: fixture.actorId,
      status: 'approved',
      now: new Date(now.getTime() + 1_000),
    });
    let reportStarted: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      reportStarted = resolve;
    });
    let allowAdapterToFinish: () => void = () => undefined;
    const mayFinish = new Promise<void>((resolve) => {
      allowAdapterToFinish = resolve;
    });
    const task = createContinueOperationTask({
      adapters: [
        {
          source: 'node',
          capabilities: ['filesystem.read_allowlisted'],
          async resume(input) {
            reportStarted();
            await mayFinish;
            const calls = new DrizzleAgentToolCallRepository(database);
            await calls.markRunning({
              operationId: input.scope.operationId,
              actorId: input.scope.actorId,
              toolCallId: input.continuation.work.toolCallId,
            });
            await calls.settle({
              operationId: input.scope.operationId,
              actorId: input.scope.actorId,
              toolCallId: input.continuation.work.toolCallId,
              status: 'succeeded',
              durationMs: 1,
              result: { status: 'read' },
            });
            await new DrizzlePlatformTurnRepository(database).settleTurn({
              conversationId: input.scope.conversationId,
              trustedSubjectId: input.scope.actorId,
              turnId: input.scope.operationId,
              status: 'completed',
              content: '业务已完成，但取消请求先于Operation终态。',
              operationTerminalWriter: 'gateway',
            });
            return {
              status: 'completed',
              messageId: fixture.assistantMessageId,
            };
          },
        },
      ],
    });
    const workerRun = runOnce({
      connectionString,
      taskList: { [OPERATION_CONTINUATION_TASK]: task },
    });
    await started;
    await expect(
      fixture.operations.requestCancellation({
        operationId: fixture.operationId,
        actorUserId: fixture.actorId,
        now: new Date(),
      }),
    ).resolves.toEqual({
      recorded: true,
      continuation: 'running',
    });
    allowAdapterToFinish();
    await workerRun;
    expect(
      await database
        .select({ status: operationContinuations.status })
        .from(operationContinuations)
        .where(eq(operationContinuations.id, fixture.continuationId)),
    ).toEqual([{ status: 'cancelled' }]);
    const events = await fixture.operations.listEvents(
      fixture.operationId,
      -1,
      fixture.actorId,
    );
    expect(events.at(-1)).toMatchObject({ type: 'operation.cancelled' });
    expect(events.some((event) => event.type === 'operation.completed')).toBe(
      false,
    );
  });

  it('未过期lease必须让Graphile重试，过期后以新generation恢复', async () => {
    const fixture = await createWaitingApproval();
    await fixture.operations.resolveApproval({
      approvalId: fixture.approvalId,
      actorUserId: fixture.actorId,
      status: 'approved',
      now: new Date(now.getTime() + 1_000),
    });
    const continuations = new DrizzleOperationContinuationRepository(database);
    const claimed = await continuations.claimForExecution({
      continuationId: fixture.continuationId,
      ownerId: 'worker:dead-process',
      leaseDurationMs: 60_000,
      now: new Date(),
    });
    expect(claimed).toMatchObject({ status: 'claimed' });
    const resumed = vi.fn();
    const task = createContinueOperationTask({
      adapters: [
        {
          source: 'node',
          capabilities: ['filesystem.read_allowlisted'],
          async resume(input) {
            resumed();
            const calls = new DrizzleAgentToolCallRepository(database);
            await calls.markRunning({
              operationId: input.scope.operationId,
              actorId: input.scope.actorId,
              toolCallId: input.continuation.work.toolCallId,
            });
            await calls.settle({
              operationId: input.scope.operationId,
              actorId: input.scope.actorId,
              toolCallId: input.continuation.work.toolCallId,
              status: 'succeeded',
              durationMs: 1,
              result: { status: 'read' },
            });
            await new DrizzlePlatformTurnRepository(database).settleTurn({
              conversationId: input.scope.conversationId,
              trustedSubjectId: input.scope.actorId,
              turnId: input.scope.operationId,
              status: 'completed',
              content: 'lease过期后恢复完成。',
              operationTerminalWriter: 'gateway',
            });
            return {
              status: 'completed',
              messageId: fixture.assistantMessageId,
            };
          },
        },
      ],
    });
    await expect(
      task({ continuationId: fixture.continuationId }, {} as never),
    ).rejects.toBeInstanceOf(OperationContinuationLeaseHeldError);
    expect(resumed).not.toHaveBeenCalled();
    await database
      .update(operationContinuations)
      .set({ leaseExpiresAt: new Date(Date.now() - 1) })
      .where(eq(operationContinuations.id, fixture.continuationId));
    await task({ continuationId: fixture.continuationId }, {} as never);
    expect(resumed).toHaveBeenCalledTimes(1);
    expect(
      await database
        .select({
          status: operationContinuations.status,
          leaseGeneration: operationContinuations.leaseGeneration,
        })
        .from(operationContinuations)
        .where(eq(operationContinuations.id, fixture.continuationId)),
    ).toEqual([{ status: 'completed', leaseGeneration: 2 }]);
  });

  it('Adapter提交业务结果后崩溃可换代恢复且不重复副作用', async () => {
    const fixture = await createWaitingApproval();
    await fixture.operations.resolveApproval({
      approvalId: fixture.approvalId,
      actorUserId: fixture.actorId,
      status: 'approved',
      now: new Date(now.getTime() + 1_000),
    });
    const businessEffect = vi.fn();
    const resumed = vi.fn();
    const adapter: OperationContinuationResumeAdapter = {
      source: 'node',
      capabilities: ['filesystem.read_allowlisted'],
      async resume(input) {
        resumed();
        const calls = new DrizzleAgentToolCallRepository(database);
        const [current] = await calls.listByOperation({
          operationId: input.scope.operationId,
          actorId: input.scope.actorId,
        });
        if (current?.status !== 'succeeded') {
          businessEffect();
          await calls.markRunning({
            operationId: input.scope.operationId,
            actorId: input.scope.actorId,
            toolCallId: input.continuation.work.toolCallId,
          });
          await calls.settle({
            operationId: input.scope.operationId,
            actorId: input.scope.actorId,
            toolCallId: input.continuation.work.toolCallId,
            status: 'succeeded',
            durationMs: 1,
            result: { status: 'read' },
          });
          await new DrizzlePlatformTurnRepository(database).settleTurn({
            conversationId: input.scope.conversationId,
            trustedSubjectId: input.scope.actorId,
            turnId: input.scope.operationId,
            status: 'completed',
            content: '已读取受控学习资料。',
            operationTerminalWriter: 'gateway',
          });
        }
        return {
          status: 'completed',
          messageId: fixture.assistantMessageId,
        };
      },
    };
    let injectCrash = true;
    const task = createContinueOperationTask({
      adapters: [adapter],
      operations: {
        cancelContinuation: (input) =>
          fixture.operations.cancelContinuation(input),
        rejectContinuationAuthorization: (input) =>
          fixture.operations.rejectContinuationAuthorization(input),
        async settleContinuation(input) {
          if (injectCrash) {
            injectCrash = false;
            throw new Error('injected_after_adapter_commit');
          }
          return fixture.operations.settleContinuation(input);
        },
      },
    });

    await expect(
      task({ continuationId: fixture.continuationId }, {} as never),
    ).rejects.toThrow('injected_after_adapter_commit');
    expect(
      await database
        .select({
          status: operationContinuations.status,
          leaseGeneration: operationContinuations.leaseGeneration,
        })
        .from(operationContinuations)
        .where(eq(operationContinuations.id, fixture.continuationId)),
    ).toEqual([{ status: 'ready', leaseGeneration: 1 }]);

    await task({ continuationId: fixture.continuationId }, {} as never);
    expect(businessEffect).toHaveBeenCalledTimes(1);
    expect(resumed).toHaveBeenCalledTimes(2);
    expect(
      await database
        .select({
          status: operationContinuations.status,
          leaseGeneration: operationContinuations.leaseGeneration,
        })
        .from(operationContinuations)
        .where(eq(operationContinuations.id, fixture.continuationId)),
    ).toEqual([{ status: 'completed', leaseGeneration: 2 }]);
    const events = await fixture.operations.listEvents(
      fixture.operationId,
      -1,
      fixture.actorId,
    );
    expect(
      events.filter((event) => event.type === 'operation.completed'),
    ).toHaveLength(1);
  });
});
