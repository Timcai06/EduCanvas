import type { GatewayOperationEvent } from '@educanvas/gateway-core';
import { sql } from 'drizzle-orm';
import {
  findCurrentOperationAccess,
  listCurrentGatewayOperationEvents,
} from './operation-access';
import { GatewayPersistenceError, type Database } from './persistence';
import { reconcileGatewayTerminalWithinTransaction } from './terminal-reconciliation';
import type { GatewayTerminalReconciliationMode } from './terminal-reconciliation-mode';

/** Scoped Web reads retain current permission checks before and after the event lock. */
export async function listScopedGatewayOperationEvents(
  database: Database,
  input: {
    operationId: string;
    afterSequence: number;
    actorUserId: string;
    now: Date;
    conversationId?: string;
    terminalReconciliationMode: GatewayTerminalReconciliationMode;
  },
): Promise<readonly GatewayOperationEvent[]> {
  const { operationId, afterSequence, actorUserId, now, conversationId } =
    input;
  const access = await findCurrentOperationAccess(database, {
    operationId,
    actorUserId,
    requiredPermission: 'notebook.read',
    now,
    conversationId,
  });
  if (!access) {
    throw new GatewayPersistenceError(
      'operation_not_found',
      'Operation not found',
    );
  }
  return database.transaction(async (transaction) => {
    await transaction.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`gateway-event-v1:${operationId}`}, 0))`,
    );
    const lockedAccess = await findCurrentOperationAccess(transaction, {
      operationId,
      actorUserId,
      requiredPermission: 'notebook.read',
      now,
      conversationId,
    });
    if (!lockedAccess) {
      throw new GatewayPersistenceError(
        'operation_not_found',
        'Operation not found',
      );
    }
    if (input.terminalReconciliationMode === 'enabled') {
      await reconcileGatewayTerminalWithinTransaction(
        transaction,
        operationId,
        now,
      );
    }
    return listCurrentGatewayOperationEvents(transaction, {
      operationId,
      afterSequence,
      actorUserId,
      now,
    });
  });
}
