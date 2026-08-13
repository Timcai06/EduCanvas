import type { NotebookPermission } from '@educanvas/gateway-core';
import { sql } from 'drizzle-orm';
import {
  findCurrentOperationAccess,
  listRecentCurrentGatewayOperations,
  requestCurrentGatewayOperationCancellation,
} from './operation-access';
import { normalizeOperationStatus } from './operation-event-writer';
import type { Database, DatabaseTransaction } from './persistence';
import { reconcileGatewayTerminalWithinTransaction } from './terminal-reconciliation';
import type { GatewayTerminalReconciliationMode } from './terminal-reconciliation-mode';

type GatewayNormalizedOperationStatus =
  'running' | 'completed' | 'failed' | 'cancelled';

async function reconcileTerminalAwareStatus(
  transaction: DatabaseTransaction,
  input: {
    operationId: string;
    actorUserId: string;
    requiredPermission: NotebookPermission;
    now: Date;
    terminalReconciliationMode: GatewayTerminalReconciliationMode;
  },
): Promise<{
  actorUserId: string;
  status: GatewayNormalizedOperationStatus;
} | null> {
  // The event lock must precede the Membership row lock taken by
  // findCurrentOperationAccess(mutation=true); cancellation uses the same order.
  await transaction.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`gateway-event-v1:${input.operationId}`}, 0))`,
  );
  const access = await findCurrentOperationAccess(transaction, {
    operationId: input.operationId,
    actorUserId: input.actorUserId,
    requiredPermission: input.requiredPermission,
    now: input.now,
    mutation: true,
  });
  if (!access) return null;
  const status =
    input.terminalReconciliationMode === 'legacy-disabled'
      ? access.status === 'running' || access.status === 'pending'
        ? 'running'
        : normalizeOperationStatus(access.status)
      : await reconcileGatewayTerminalWithinTransaction(
          transaction,
          input.operationId,
          input.now,
        );
  return { actorUserId: access.actorUserId, status };
}

/** Read the current reply-authorized operation after reconciling durable terminal intent. */
export async function describeTerminalAwareGatewayOperation(
  database: Database,
  input: {
    operationId: string;
    actorUserId: string;
    now: Date;
    terminalReconciliationMode: GatewayTerminalReconciliationMode;
  },
): Promise<{
  operationId: string;
  actorUserId: string;
  status: GatewayNormalizedOperationStatus;
} | null> {
  return database.transaction(async (transaction) => {
    const loaded = await reconcileTerminalAwareStatus(transaction, {
      ...input,
      requiredPermission: 'conversation.reply',
    });
    if (!loaded) return null;
    return {
      operationId: input.operationId,
      actorUserId: loaded.actorUserId,
      status: loaded.status,
    };
  });
}

/** Record cancellation using the same terminal reconciliation policy as reads. */
export async function requestTerminalAwareGatewayOperationCancellation(
  database: Database,
  input: {
    operationId: string;
    actorUserId: string;
    now: Date;
    terminalReconciliationMode: GatewayTerminalReconciliationMode;
  },
): Promise<{
  recorded: boolean;
  continuation: 'none' | 'running' | 'cancelled';
}> {
  return requestCurrentGatewayOperationCancellation(database, {
    operationId: input.operationId,
    actorUserId: input.actorUserId,
    now: input.now,
    reconcileTerminal:
      input.terminalReconciliationMode === 'enabled'
        ? (transaction, operationId, now) =>
            reconcileGatewayTerminalWithinTransaction(
              transaction,
              operationId,
              now,
            )
        : undefined,
  });
}

/** List current readable turn operations and reconcile each candidate terminal atomically. */
export async function listRecentTerminalAwareGatewayOperations(
  database: Database,
  input: {
    actorUserId: string;
    limit: number;
    now: Date;
    terminalReconciliationMode: GatewayTerminalReconciliationMode;
  },
): Promise<
  readonly {
    operationId: string;
    conversationId: string;
    conversationTitle: string | null;
    status: GatewayNormalizedOperationStatus;
    createdAt: string;
  }[]
> {
  const candidates = await listRecentCurrentGatewayOperations(database, input);
  const result: (typeof candidates)[number][] = [];
  for (const candidate of candidates) {
    const loaded = await database.transaction((transaction) =>
      reconcileTerminalAwareStatus(transaction, {
        operationId: candidate.operationId,
        actorUserId: input.actorUserId,
        requiredPermission: 'notebook.read',
        now: input.now,
        terminalReconciliationMode: input.terminalReconciliationMode,
      }),
    );
    if (loaded) result.push({ ...candidate, status: loaded.status });
  }
  return result;
}
