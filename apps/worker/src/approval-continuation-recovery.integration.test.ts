import {
  DrizzleAgentToolCallRepository,
  DrizzleOperationContinuationRepository,
  DrizzlePlatformTurnRepository,
  operationContinuations,
} from '@educanvas/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import {
  createWaitingApproval,
  database,
  installApprovalContinuationIntegrationHooks,
  now,
} from './approval-continuation.integration-support.js';
import {
  createContinueOperationTask,
  OperationContinuationLeaseHeldError,
  type OperationContinuationResumeAdapter,
} from './tasks/continue-operation.js';

describe('Gateway approval到continuation队列的原子边界', () => {
  installApprovalContinuationIntegrationHooks();

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
