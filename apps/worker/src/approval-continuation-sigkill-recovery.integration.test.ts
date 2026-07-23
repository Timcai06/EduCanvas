import { OPERATION_CONTINUATION_TASK } from '@educanvas/agent-core';
import {
  DrizzleAgentToolCallRepository,
  DrizzleOperationContinuationRecoveryRepository,
  DrizzleOperationContinuationRepository,
  DrizzlePlatformTurnRepository,
  OperationContinuationConflictError,
  operationContinuations,
} from '@educanvas/db';
import { eq } from 'drizzle-orm';
import { runOnce } from 'graphile-worker';
import { once } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import {
  connectionString,
  createWaitingApproval,
  database,
  installApprovalContinuationIntegrationHooks,
  now,
} from './approval-continuation.integration-support.js';
import {
  listContinuationJobs,
  spawnBlockingContinuationWorker,
  waitForBlockingAdapter,
} from './approval-continuation-sigkill.integration-support.js';
import { createContinueOperationTask } from './tasks/continue-operation.js';

describe('Graphile异常退出后的continuation恢复', () => {
  installApprovalContinuationIntegrationHooks();

  it('SIGKILL后用业务lease恢复替换locked job并以新generation完成', async () => {
    const fixture = await createWaitingApproval();
    await fixture.operations.resolveApproval({
      approvalId: fixture.approvalId,
      actorUserId: fixture.actorId,
      status: 'approved',
      now: new Date(now.getTime() + 1_000),
    });

    const child = spawnBlockingContinuationWorker(fixture.continuationId);
    let childAdapterStarts = 0;
    child.on('message', (message: unknown) => {
      if ((message as { type?: string }).type === 'adapter_started') {
        childAdapterStarts += 1;
      }
    });
    let childExited = false;
    let allowReplacement: () => void = () => undefined;
    let replacementRun: Promise<void> | undefined;
    try {
      await waitForBlockingAdapter(child);
      const [lockedJob] = await listContinuationJobs();
      expect(lockedJob).toMatchObject({
        key: `operation-continuation:${fixture.continuationId}`,
        payload: { continuationId: fixture.continuationId },
        attempts: 1,
      });
      expect(lockedJob?.lockedAt).toEqual(expect.any(String));
      expect(lockedJob?.lockedBy).toBeTruthy();
      expect(childAdapterStarts).toBe(1);

      const continuations = new DrizzleOperationContinuationRepository(
        database,
      );
      const firstGeneration = await continuations.get({
        continuationId: fixture.continuationId,
        actorId: fixture.actorId,
      });
      expect(firstGeneration).toMatchObject({
        status: 'running',
        leaseGeneration: 1,
      });

      const exit = once(child, 'exit');
      expect(child.kill('SIGKILL')).toBe(true);
      const [exitCode, signal] = await exit;
      childExited = true;
      expect(exitCode).toBeNull();
      expect(signal).toBe('SIGKILL');
      expect(childAdapterStarts).toBe(1);

      await database
        .update(operationContinuations)
        .set({ leaseExpiresAt: new Date(Date.now() - 1_000) })
        .where(eq(operationContinuations.id, fixture.continuationId));
      const recovery = new DrizzleOperationContinuationRecoveryRepository(
        database,
      );
      await expect(
        recovery.requeueExpiredForExecution({ limit: 10 }),
      ).resolves.toEqual({
        examined: 1,
        requeued: 1,
        generationExhausted: 0,
      });

      const recoveredJobs = await listContinuationJobs();
      expect(recoveredJobs).toHaveLength(2);
      const exhausted = recoveredJobs.find((job) => job.id === lockedJob?.id);
      const successor = recoveredJobs.find((job) => job.id !== lockedJob?.id);
      expect(exhausted).toMatchObject({
        key: null,
        attempts: exhausted?.maxAttempts,
      });
      expect(exhausted?.lockedAt).toEqual(expect.any(String));
      expect(successor).toMatchObject({
        key: `operation-continuation:${fixture.continuationId}`,
        payload: { continuationId: fixture.continuationId },
        lockedAt: null,
        lockedBy: null,
        attempts: 0,
      });
      expect(Object.keys(successor?.payload as object)).toEqual([
        'continuationId',
      ]);

      const replacementMayFinish = new Promise<void>((resolve) => {
        allowReplacement = resolve;
      });
      let reportReplacementStarted!: () => void;
      const replacementStarted = new Promise<void>((resolve) => {
        reportReplacementStarted = resolve;
      });
      const resumed = vi.fn(async (input) => {
        reportReplacementStarted();
        await replacementMayFinish;
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
          content: 'SIGKILL恢复后完成。',
          operationTerminalWriter: 'gateway',
        });
        return {
          status: 'completed' as const,
          messageId: fixture.assistantMessageId,
        };
      });
      replacementRun = runOnce({
        connectionString,
        taskList: {
          [OPERATION_CONTINUATION_TASK]: createContinueOperationTask({
            adapters: [
              {
                source: 'node',
                capabilities: ['filesystem.read_allowlisted'],
                resume: resumed,
              },
            ],
          }),
        },
      });
      await replacementStarted;

      const secondGeneration = await continuations.get({
        continuationId: fixture.continuationId,
        actorId: fixture.actorId,
      });
      expect(secondGeneration).toMatchObject({
        status: 'running',
        leaseGeneration: 2,
      });
      expect(
        await continuations.heartbeat({
          continuationId: fixture.continuationId,
          actorId: fixture.actorId,
          ownerId: firstGeneration!.leaseOwnerId!,
          leaseGeneration: 1,
          leaseDurationMs: 60_000,
        }),
      ).toBe(false);
      await expect(
        continuations.settle({
          continuationId: fixture.continuationId,
          actorId: fixture.actorId,
          ownerId: firstGeneration!.leaseOwnerId!,
          leaseGeneration: 1,
          status: 'completed',
        }),
      ).rejects.toBeInstanceOf(OperationContinuationConflictError);

      allowReplacement();
      await replacementRun;
      expect(resumed).toHaveBeenCalledTimes(1);
      await expect(
        continuations.get({
          continuationId: fixture.continuationId,
          actorId: fixture.actorId,
        }),
      ).resolves.toMatchObject({ status: 'completed', leaseGeneration: 2 });
    } finally {
      allowReplacement();
      await replacementRun?.catch(() => undefined);
      if (
        !childExited &&
        child.exitCode === null &&
        child.signalCode === null
      ) {
        child.kill('SIGKILL');
        await once(child, 'exit');
      }
    }
  });
});
