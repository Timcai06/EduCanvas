import type { OperationContinuationSnapshot } from '@educanvas/agent-core';
import type { ContinuationTraceInput } from '@educanvas/telemetry';
import { describe, expect, it, vi } from 'vitest';
import { createContinueOperationTask } from './continue-operation';

const operationId = '10000000-0000-4000-8000-000000000001';
const continuationId = '20000000-0000-4000-8000-000000000001';
const traceCarrier = {
  traceparent: `00-${'a'.repeat(32)}-${'b'.repeat(16)}-01`,
} as const;

function claimedContinuation(): OperationContinuationSnapshot {
  const now = new Date().toISOString();
  return {
    protocol: 'educanvas.operation-continuation.v1',
    continuationId,
    operationId,
    sequence: 1,
    status: 'running',
    approvalId: 'approval:test',
    work: {
      kind: 'tool_invocation',
      step: 'tool.invoke',
      toolCallId: '30000000-0000-4000-8000-000000000001',
      adapterSource: 'node',
      resumeRef: 'resume:test',
    },
    traceCarrier,
    leaseGeneration: 1,
    leaseOwnerId: 'worker:test',
    leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    heartbeatAt: now,
    failureCode: null,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
  };
}

describe('continue operation trace boundary', () => {
  it('领取成功后在trace callback内完成resume与settle且payload仍只含ID', async () => {
    let traceActive = false;
    const resume = vi.fn(async () => {
      expect(traceActive).toBe(true);
      return { status: 'completed' as const, messageId: 'message:test' };
    });
    const settleContinuation = vi.fn(async () => {
      expect(traceActive).toBe(true);
      return { settled: true } as never;
    });
    const traceRun = vi.fn();
    const claimForExecution = vi.fn(async () => ({
      status: 'claimed' as const,
      continuation: claimedContinuation(),
      scope: {
        operationId,
        actorId: 'actor:test',
        agentId: 'agent:test',
        notebookId: 'notebook:test',
        conversationId: 'conversation:test',
        profileId: 'profile:test',
        traceId: 'application-trace-id',
        capability: 'filesystem.read_allowlisted',
        risk: 'l2' as const,
      },
    }));
    const task = createContinueOperationTask({
      continuations: {
        claimForExecution,
        heartbeat: vi.fn(async () => true),
        release: vi.fn(async () => ({ transitioned: true }) as never),
      },
      operations: {
        cancelContinuation: vi.fn(async () => ({ cancelled: true }) as never),
        rejectContinuationAuthorization: vi.fn(
          async () => ({ rejected: true }) as never,
        ),
        settleContinuation,
      },
      adapters: [
        {
          source: 'node',
          capabilities: ['filesystem.read_allowlisted'],
          resume,
        },
      ],
      trace: {
        async run<T>(
          input: ContinuationTraceInput,
          callback: () => Promise<T>,
        ): Promise<T> {
          traceRun(input, callback);
          traceActive = true;
          try {
            return await callback();
          } finally {
            traceActive = false;
          }
        },
      },
      leaseDurationMs: 5_000,
    });

    await task({ continuationId }, {} as never);

    expect(traceRun).toHaveBeenCalledWith(
      { operationId, carrier: traceCarrier },
      expect.any(Function),
    );
    expect(resume).toHaveBeenCalledTimes(1);
    expect(settleContinuation).toHaveBeenCalledTimes(1);
    expect(claimForExecution).toHaveBeenCalledWith({
      continuationId,
      ownerId: expect.stringMatching(/^worker:\d+:/),
      leaseDurationMs: 5_000,
    });
    await expect(
      task(
        { continuationId, traceparent: traceCarrier.traceparent },
        {} as never,
      ),
    ).rejects.toThrow();
    expect(claimForExecution).toHaveBeenCalledTimes(1);
  });
});
