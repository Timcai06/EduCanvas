import { randomUUID } from 'node:crypto';
import {
  OPERATION_CONTINUATION_TASK,
  type OperationContinuationAdapterSource,
  type OperationContinuationSnapshot,
} from '@educanvas/agent-core';
import {
  DrizzleGatewayOperationStore,
  DrizzleOperationContinuationRepository,
  type OperationContinuationExecutionScope,
} from '@educanvas/db';
import type { ContinuationTracePort } from '@educanvas/telemetry';
import type { Task } from 'graphile-worker';
import { z } from 'zod';
import { createProductionMcpContinuationAdapters } from '../mcp/production-adapter';

const payloadSchema = z.object({ continuationId: z.uuid() }).strict();

const NOOP_CONTINUATION_TRACE: ContinuationTracePort = {
  run(_input, callback) {
    return callback();
  },
};

/** Adapter完成自身耐久副作用后的受控结果；不得携带原始工具输出或凭据。 */
export type OperationContinuationResumeResult =
  | { status: 'completed'; messageId: string }
  | {
      status: 'failed';
      continuationFailureCode: string;
      operationFailureCode:
        'CAPABILITY_UNAVAILABLE' | 'FORBIDDEN' | 'RUNTIME_FAILED';
      retryable: boolean;
    };

/** Adapter负责按resumeRef恢复自身耐久意图，并在返回前结算Tool/effect与消息账本。 */
export interface OperationContinuationResumeAdapter {
  source: OperationContinuationAdapterSource;
  capabilities: readonly string[];
  resume(input: {
    continuation: OperationContinuationSnapshot;
    scope: OperationContinuationExecutionScope;
    signal: AbortSignal;
  }): Promise<OperationContinuationResumeResult>;
}

interface ContinuationRepositoryPort {
  claimForExecution(
    input: Parameters<
      DrizzleOperationContinuationRepository['claimForExecution']
    >[0],
  ): ReturnType<DrizzleOperationContinuationRepository['claimForExecution']>;
  heartbeat(
    input: Parameters<DrizzleOperationContinuationRepository['heartbeat']>[0],
  ): ReturnType<DrizzleOperationContinuationRepository['heartbeat']>;
  release(
    input: Parameters<DrizzleOperationContinuationRepository['release']>[0],
  ): ReturnType<DrizzleOperationContinuationRepository['release']>;
}

interface OperationStorePort {
  cancelContinuation(
    input: Parameters<DrizzleGatewayOperationStore['cancelContinuation']>[0],
  ): ReturnType<DrizzleGatewayOperationStore['cancelContinuation']>;
  rejectContinuationAuthorization(
    input: Parameters<
      DrizzleGatewayOperationStore['rejectContinuationAuthorization']
    >[0],
  ): ReturnType<
    DrizzleGatewayOperationStore['rejectContinuationAuthorization']
  >;
  settleContinuation(
    input: Parameters<DrizzleGatewayOperationStore['settleContinuation']>[0],
  ): ReturnType<DrizzleGatewayOperationStore['settleContinuation']>;
}

/** Graphile必须重试仍由存活/未过期generation持有的任务，不能把它误报成功。 */
export class OperationContinuationLeaseHeldError extends Error {
  constructor(readonly retryAt: string) {
    super('continuation_lease_held');
    this.name = 'OperationContinuationLeaseHeldError';
  }
}

/**
 * 构造可测试的continuation worker。队列payload只有continuationId；恢复身份、
 * Notebook权限和approval全部由claimForExecution从PostgreSQL重新计算。
 */
export function createContinueOperationTask(input: {
  continuations?: ContinuationRepositoryPort;
  operations?: OperationStorePort;
  adapters: readonly OperationContinuationResumeAdapter[];
  trace?: ContinuationTracePort;
  leaseDurationMs?: number;
}): Task {
  const continuations =
    input.continuations ?? new DrizzleOperationContinuationRepository();
  const operations = input.operations ?? new DrizzleGatewayOperationStore();
  const leaseDurationMs = input.leaseDurationMs ?? 60_000;
  const continuationTrace = input.trace ?? NOOP_CONTINUATION_TRACE;
  const adapters = new Map<string, OperationContinuationResumeAdapter>();
  for (const adapter of input.adapters) {
    if (adapter.capabilities.length === 0) {
      throw new Error(`continuation adapter未声明能力: ${adapter.source}`);
    }
    for (const capability of adapter.capabilities) {
      if (!/^[a-z][a-z0-9._:-]{0,127}$/.test(capability)) {
        throw new Error(`continuation adapter能力名无效: ${capability}`);
      }
      const key = `${adapter.source}:${capability}`;
      if (adapters.has(key)) {
        throw new Error(`重复continuation adapter: ${key}`);
      }
      adapters.set(key, adapter);
    }
  }

  return async (rawPayload, helpers) => {
    const payload = payloadSchema.parse(rawPayload);
    const ownerId = `worker:${process.pid}:${randomUUID()}`;
    const claimed = await continuations.claimForExecution({
      continuationId: payload.continuationId,
      ownerId,
      leaseDurationMs,
    });
    if (claimed.status === 'not_claimed') return;
    if (claimed.status === 'lease_held') {
      throw new OperationContinuationLeaseHeldError(claimed.retryAt);
    }
    if (claimed.status === 'cancellation_requested') {
      await operations.cancelContinuation({
        continuationId: payload.continuationId,
        operationId: claimed.operationId,
        actorUserId: claimed.actorId,
      });
      return;
    }
    if (claimed.status === 'reauthorization_failed') {
      await operations.rejectContinuationAuthorization({
        continuationId: payload.continuationId,
        operationId: claimed.operationId,
        actorUserId: claimed.actorId,
      });
      return;
    }

    const { continuation, scope } = claimed;
    await continuationTrace.run(
      {
        operationId: continuation.operationId,
        carrier: continuation.traceCarrier,
      },
      async () => {
        const adapter = adapters.get(
          `${continuation.work.adapterSource}:${scope.capability}`,
        );
        const controller = new AbortController();
        const workerSignal = helpers?.abortSignal;
        const abortForWorkerShutdown = () =>
          controller.abort('graphile_worker_shutdown');
        if (workerSignal?.aborted) abortForWorkerShutdown();
        else
          workerSignal?.addEventListener('abort', abortForWorkerShutdown, {
            once: true,
          });
        const heartbeatEveryMs = Math.max(
          1_000,
          Math.min(5_000, Math.floor(leaseDurationMs / 3)),
        );
        const timer = setInterval(() => {
          void continuations
            .heartbeat({
              continuationId: continuation.continuationId,
              actorId: scope.actorId,
              ownerId,
              leaseGeneration: continuation.leaseGeneration,
              leaseDurationMs,
            })
            .then((renewed) => {
              if (!renewed) controller.abort('continuation_lease_lost');
            })
            .catch(() => controller.abort('continuation_heartbeat_failed'));
        }, heartbeatEveryMs);
        timer.unref?.();
        try {
          if (!adapter) {
            await operations.settleContinuation({
              continuationId: continuation.continuationId,
              operationId: continuation.operationId,
              ownerId,
              leaseGeneration: continuation.leaseGeneration,
              result: {
                status: 'failed',
                continuationFailureCode: 'adapter_unavailable',
                operationFailureCode: 'CAPABILITY_UNAVAILABLE',
                retryable: false,
              },
            });
            return;
          }
          const result = await adapter.resume({
            continuation,
            scope,
            signal: controller.signal,
          });
          if (controller.signal.aborted) {
            throw new Error('continuation_lease_lost');
          }
          await operations.settleContinuation({
            continuationId: continuation.continuationId,
            operationId: continuation.operationId,
            ownerId,
            leaseGeneration: continuation.leaseGeneration,
            result,
          });
        } catch (error) {
          await continuations
            .release({
              continuationId: continuation.continuationId,
              actorId: scope.actorId,
              ownerId,
              leaseGeneration: continuation.leaseGeneration,
            })
            .catch(() => undefined);
          throw error;
        } finally {
          clearInterval(timer);
          workerSignal?.removeEventListener('abort', abortForWorkerShutdown);
          controller.abort('continuation_finished');
        }
      },
    );
  };
}

/** 生产只注册配置完整的耐久Adapter；缺密钥/配置时仍以adapter_unavailable诚实失败。 */
export function createProductionContinueOperationTask(
  trace: ContinuationTracePort,
): Task {
  return createContinueOperationTask({
    adapters: createProductionMcpContinuationAdapters(),
    trace,
  });
}

export { OPERATION_CONTINUATION_TASK };
