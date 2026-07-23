import { OPERATION_CONTINUATION_TASK } from '@educanvas/agent-core';
import {
  DrizzleAgentToolCallRepository,
  DrizzleMcpIntentRepository,
  DrizzlePlatformTurnRepository,
  DrizzleToolEffectRepository,
  GatewayPersistenceError,
  gatewayApprovals,
  gatewayOperationEvents,
  mcpToolIntents,
  operationContinuations,
  toolApprovalIntents,
} from '@educanvas/db';
import { eq, sql } from 'drizzle-orm';
import { runOnce } from 'graphile-worker';
import type { ContinuationTraceInput } from '@educanvas/telemetry';
import { describe, expect, it, vi } from 'vitest';
import {
  approvalTraceCarrier,
  connectionString,
  createWaitingApproval,
  database,
  installApprovalContinuationIntegrationHooks,
  mcpKey,
  mcpRegistration,
  now,
} from './approval-continuation.integration-support.js';
import { createMcpContinuationAdapter } from './mcp/continuation-adapter.js';
import { createContinueOperationTask } from './tasks/continue-operation.js';

describe('Gateway approval到continuation队列的原子边界', () => {
  installApprovalContinuationIntegrationHooks();

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
    const continuationTraceInputs: ContinuationTraceInput[] = [];
    const continuationTrace = {
      run<T>(input: ContinuationTraceInput, callback: () => Promise<T>) {
        continuationTraceInputs.push(input);
        return callback();
      },
    };
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
      trace: continuationTrace,
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
    expect(continuationTraceInputs).toEqual([
      {
        operationId: fixture.operationId,
        carrier: approvalTraceCarrier,
      },
    ]);
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
});
