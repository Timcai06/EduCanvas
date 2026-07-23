import type {
  CreateOperationContinuationInput,
  OperationContinuationPort,
  OperationContinuationTerminalStatus,
} from '@educanvas/agent-core';
import { getDb } from '../client';
import {
  claimContinuation,
  claimContinuationForExecution,
} from './claim-store';
import type { OperationContinuationExecutionClaim } from './contracts';
import { heartbeatContinuation, releaseContinuation } from './lease-store';
import type { ContinuationDatabase } from './persistence';
import { cancelContinuation, settleContinuation } from './settlement-store';
import {
  createWaitingContinuation,
  getActiveContinuation,
  getOwnedContinuation,
  markContinuationReady,
} from './waiting-store';

/** PostgreSQL continuation账本的稳定组合入口。 */
export class DrizzleOperationContinuationRepository implements OperationContinuationPort {
  constructor(private readonly providedDatabase?: ContinuationDatabase) {}

  private get database(): ContinuationDatabase {
    return this.providedDatabase ?? getDb();
  }

  createWaiting(rawInput: CreateOperationContinuationInput & { now?: Date }) {
    return createWaitingContinuation(this.database, rawInput);
  }

  get(input: { continuationId: string; actorId: string }) {
    return getOwnedContinuation(this.database, input);
  }

  getActive(input: { operationId: string; actorId: string }) {
    return getActiveContinuation(this.database, input);
  }

  markReady(input: {
    continuationId: string;
    actorId: string;
    approvalId: string;
    now?: Date;
  }) {
    return markContinuationReady(this.database, input);
  }

  claim(input: {
    continuationId: string;
    actorId: string;
    ownerId: string;
    leaseDurationMs: number;
    now?: Date;
  }) {
    return claimContinuation(this.database, input);
  }

  /** 队列仅传continuationId；执行范围由数据库重新授权后返回。 */
  claimForExecution(input: {
    continuationId: string;
    ownerId: string;
    leaseDurationMs: number;
    now?: Date;
  }): Promise<OperationContinuationExecutionClaim> {
    return claimContinuationForExecution(this.database, input);
  }

  heartbeat(input: {
    continuationId: string;
    actorId: string;
    ownerId: string;
    leaseGeneration: number;
    leaseDurationMs: number;
    now?: Date;
  }) {
    return heartbeatContinuation(this.database, input);
  }

  release(input: {
    continuationId: string;
    actorId: string;
    ownerId: string;
    leaseGeneration: number;
    now?: Date;
  }) {
    return releaseContinuation(this.database, input);
  }

  settle(input: {
    continuationId: string;
    actorId: string;
    ownerId: string;
    leaseGeneration: number;
    status: OperationContinuationTerminalStatus;
    failureCode?: string | null;
    now?: Date;
  }) {
    return settleContinuation(this.database, input);
  }

  cancel(input: { operationId: string; actorId: string; now?: Date }) {
    return cancelContinuation(this.database, input);
  }
}
