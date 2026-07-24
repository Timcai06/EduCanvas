import { OPERATION_CONTINUATION_TASK } from '@educanvas/agent-core';
import {
  gatewayApprovals,
  gatewayOperationEvents,
  notebookMemberships,
  operationContinuations,
} from '@educanvas/db';
import { eq, sql } from 'drizzle-orm';
import { runOnce } from 'graphile-worker';
import { describe, expect, it, vi } from 'vitest';
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
    await expect(
      fixture.operations.listEvents(
        fixture.operationId,
        -1,
        fixture.actorId,
        new Date(now.getTime() + 3_000),
      ),
    ).rejects.toMatchObject({ code: 'operation_not_found' });
    const events = await database
      .select({ payload: gatewayOperationEvents.payload })
      .from(gatewayOperationEvents)
      .where(eq(gatewayOperationEvents.operationId, fixture.operationId))
      .orderBy(gatewayOperationEvents.sequence);
    expect(events.at(-1)?.payload).toMatchObject({
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
});
