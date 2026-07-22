import { OPERATION_CONTINUATION_TASK } from '@educanvas/agent-core';
import {
  DrizzleAgentToolCallRepository,
  DrizzlePlatformTurnRepository,
  operationContinuations,
} from '@educanvas/db';
import { eq } from 'drizzle-orm';
import { runOnce } from 'graphile-worker';
import { describe, expect, it } from 'vitest';
import {
  connectionString,
  createWaitingApproval,
  database,
  installApprovalContinuationIntegrationHooks,
  now,
} from './approval-continuation.integration-support.js';
import { createContinueOperationTask } from './tasks/continue-operation.js';

describe('Gateway approval到continuation队列的原子边界', () => {
  installApprovalContinuationIntegrationHooks();

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
});
