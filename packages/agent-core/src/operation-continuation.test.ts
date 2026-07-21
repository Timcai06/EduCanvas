import { describe, expect, it } from 'vitest';
import {
  createOperationContinuationInputSchema,
  operationContinuationProtocolVersion,
  operationContinuationSnapshotSchema,
} from './operation-continuation';

const base = {
  protocol: operationContinuationProtocolVersion,
  continuationId: 'continuation:1',
  operationId: 'operation:1',
  sequence: 1,
  approvalId: 'approval:1',
  work: {
    kind: 'tool_invocation' as const,
    step: 'tool.invoke' as const,
    toolCallId: 'tool-call:1',
    adapterSource: 'node' as const,
    resumeRef: 'node-invocation:1',
  },
  leaseGeneration: 0,
  leaseOwnerId: null,
  leaseExpiresAt: null,
  heartbeatAt: null,
  failureCode: null,
  createdAt: '2026-07-21T12:00:00.000Z',
  updatedAt: '2026-07-21T12:00:00.000Z',
  completedAt: null,
};

describe('Operation continuation contract', () => {
  it('只接受稳定引用，不提供任意checkpoint payload字段', () => {
    expect(
      createOperationContinuationInputSchema.parse({
        operationId: 'operation:1',
        actorId: 'user:1',
        approvalId: 'approval:1',
        work: base.work,
      }),
    ).toEqual({
      operationId: 'operation:1',
      actorId: 'user:1',
      approvalId: 'approval:1',
      work: base.work,
    });
    expect(
      createOperationContinuationInputSchema.safeParse({
        operationId: 'operation:1',
        actorId: 'user:1',
        approvalId: 'approval:1',
        work: { ...base.work, prompt: '不应持久化' },
      }).success,
    ).toBe(false);
  });

  it('强制running持有完整lease且非running不保留lease', () => {
    expect(
      operationContinuationSnapshotSchema.safeParse({
        ...base,
        status: 'waiting_approval',
      }).success,
    ).toBe(true);
    expect(
      operationContinuationSnapshotSchema.safeParse({
        ...base,
        status: 'running',
      }).success,
    ).toBe(false);
    expect(
      operationContinuationSnapshotSchema.safeParse({
        ...base,
        status: 'running',
        leaseGeneration: 1,
        leaseOwnerId: 'worker:1',
        leaseExpiresAt: '2026-07-21T12:01:00.000Z',
        heartbeatAt: '2026-07-21T12:00:01.000Z',
      }).success,
    ).toBe(true);
  });

  it('终态完成时间与failed稳定错误码必须一致', () => {
    expect(
      operationContinuationSnapshotSchema.safeParse({
        ...base,
        status: 'completed',
        completedAt: '2026-07-21T12:00:02.000Z',
      }).success,
    ).toBe(true);
    expect(
      operationContinuationSnapshotSchema.safeParse({
        ...base,
        status: 'failed',
        completedAt: '2026-07-21T12:00:02.000Z',
      }).success,
    ).toBe(false);
    expect(
      operationContinuationSnapshotSchema.safeParse({
        ...base,
        status: 'failed',
        failureCode: 'resume_failed',
        completedAt: '2026-07-21T12:00:02.000Z',
      }).success,
    ).toBe(true);
  });
});
