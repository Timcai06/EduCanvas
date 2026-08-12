import {
  gatewayFailureCodeSchema,
  gatewayOperationEventSchema,
  isGatewayTerminalEvent,
  type GatewayFailureCode,
  type GatewayOperationEvent,
} from '@educanvas/gateway-core';
import { and, asc, eq, inArray } from 'drizzle-orm';
import {
  agentOperations,
  conversationMessages,
  gatewayOperationEvents,
} from '../schema';
import {
  appendGatewayOperationEvent,
  normalizeOperationStatus,
  type GatewayEventPayload,
} from './operation-event-writer';
import {
  GatewayPersistenceError,
  type DatabaseTransaction,
} from './persistence';

const INTENT_PREFIX = 'gateway_terminal_intent_v1';

export type DurableGatewayTerminalIntent =
  | { status: 'completed'; messageId: string }
  | { status: 'failed'; code: GatewayFailureCode; retryable: boolean }
  | { status: 'cancelled' };

/**
 * agent_operations.failure_code is the only existing safe scalar available on
 * the running Operation. Until a dedicated column can be migrated, this closed
 * encoding stores the terminal intent without正文、Provider response or stack.
 * appendGatewayOperationEvent replaces it with the ordinary terminal code/null.
 */
export function encodeGatewayTerminalIntent(
  intent: DurableGatewayTerminalIntent,
): string {
  switch (intent.status) {
    case 'completed':
      return `${INTENT_PREFIX}:completed:${intent.messageId}`;
    case 'failed':
      return `${INTENT_PREFIX}:failed:${intent.code}:${intent.retryable ? '1' : '0'}`;
    case 'cancelled':
      return `${INTENT_PREFIX}:cancelled`;
  }
}

export function parseGatewayTerminalIntent(
  value: string | null,
): DurableGatewayTerminalIntent | null {
  if (!value?.startsWith(`${INTENT_PREFIX}:`)) return null;
  const segments = value.split(':');
  if (segments[1] === 'completed' && segments.length === 3) {
    return /^[0-9a-f-]{36}$/i.test(segments[2] ?? '')
      ? { status: 'completed', messageId: segments[2]! }
      : null;
  }
  if (segments[1] === 'cancelled' && segments.length === 2) {
    return { status: 'cancelled' };
  }
  if (segments[1] === 'failed' && segments.length === 4) {
    const code = gatewayFailureCodeSchema.safeParse(segments[2]);
    if (code.success && (segments[3] === '0' || segments[3] === '1')) {
      return {
        status: 'failed',
        code: code.data,
        retryable: segments[3] === '1',
      };
    }
  }
  return null;
}

function terminalPayload(
  intent: DurableGatewayTerminalIntent,
): GatewayEventPayload {
  switch (intent.status) {
    case 'completed':
      return { type: 'operation.completed', messageId: intent.messageId };
    case 'failed':
      return {
        type: 'operation.failed',
        code: intent.code,
        retryable: intent.retryable,
      };
    case 'cancelled':
      return { type: 'operation.cancelled' };
  }
}

export function gatewayTerminalEventMatchesIntent(
  event: GatewayOperationEvent,
  intent: DurableGatewayTerminalIntent,
): boolean {
  if (!isGatewayTerminalEvent(event)) return false;
  if (intent.status === 'completed') {
    return (
      event.type === 'operation.completed' &&
      event.messageId === intent.messageId
    );
  }
  if (intent.status === 'failed') {
    return (
      event.type === 'operation.failed' &&
      event.code === intent.code &&
      event.retryable === intent.retryable
    );
  }
  return event.type === 'operation.cancelled';
}

function assistantMatchesIntent(
  assistant: { id: string; status: string } | undefined,
  intent: DurableGatewayTerminalIntent,
): boolean {
  if (!assistant) return false;
  return intent.status === 'completed'
    ? assistant.status === 'completed' && assistant.id === intent.messageId
    : assistant.status === intent.status;
}

function terminalEventIntent(
  event: GatewayOperationEvent,
): DurableGatewayTerminalIntent | null {
  if (event.type === 'operation.completed') {
    return { status: 'completed', messageId: event.messageId };
  }
  if (event.type === 'operation.failed') {
    return {
      status: 'failed',
      code: event.code,
      retryable: event.retryable,
    };
  }
  return event.type === 'operation.cancelled' ? { status: 'cancelled' } : null;
}

/**
 * Reconcile only persisted facts under the same Operation event lock. It may
 * append the missing terminal event, but never invokes the model, tools or the
 * Turn Application again. Conflicting or malformed intent fails closed.
 */
export async function reconcileGatewayTerminalWithinTransaction(
  transaction: DatabaseTransaction,
  operationId: string,
  now: Date,
): Promise<'running' | 'completed' | 'failed' | 'cancelled'> {
  const [operation] = await transaction
    .select({
      kind: agentOperations.kind,
      status: agentOperations.status,
      failureCode: agentOperations.failureCode,
    })
    .from(agentOperations)
    .where(eq(agentOperations.id, operationId))
    .limit(1);
  if (!operation) {
    throw new GatewayPersistenceError(
      'operation_not_found',
      'Operation not found',
    );
  }
  const encodedIntent = operation.failureCode?.startsWith(`${INTENT_PREFIX}:`);
  const intent = parseGatewayTerminalIntent(operation.failureCode);
  if (encodedIntent && !intent) {
    throw new GatewayPersistenceError(
      'invalid_event_sequence',
      'Gateway terminal intent is malformed',
    );
  }
  const [assistant] = await transaction
    .select({
      content: conversationMessages.content,
      id: conversationMessages.id,
      status: conversationMessages.status,
    })
    .from(conversationMessages)
    .where(
      and(
        eq(conversationMessages.operationId, operationId),
        eq(conversationMessages.role, 'assistant'),
      ),
    )
    .limit(1);
  const terminalEvents = (
    await transaction
      .select({ payload: gatewayOperationEvents.payload })
      .from(gatewayOperationEvents)
      .where(
        and(
          eq(gatewayOperationEvents.operationId, operationId),
          inArray(gatewayOperationEvents.type, [
            'operation.completed',
            'operation.failed',
            'operation.cancelled',
          ]),
        ),
      )
      .orderBy(asc(gatewayOperationEvents.sequence))
  ).map(({ payload }) => gatewayOperationEventSchema.parse(payload));
  const operationStatus = normalizeOperationStatus(operation.status);
  if (intent && operation.kind !== 'turn') {
    throw new GatewayPersistenceError(
      'invalid_event_sequence',
      'Only turn operations may carry a Gateway terminal intent',
    );
  }
  if (!intent) {
    if (operationStatus === 'running') {
      if (terminalEvents.length > 0) {
        throw new GatewayPersistenceError(
          'invalid_event_sequence',
          'Running operation already has a terminal event',
        );
      }
      return 'running';
    }
    if (terminalEvents.length !== 1) {
      throw new GatewayPersistenceError(
        'invalid_event_sequence',
        'Terminal operation must have exactly one terminal event',
      );
    }
    const eventIntent = terminalEventIntent(terminalEvents[0]!);
    if (!eventIntent || eventIntent.status !== operationStatus) {
      throw new GatewayPersistenceError(
        'invalid_event_sequence',
        'Operation and terminal event status conflict',
      );
    }
    if (assistant) {
      if (operation.kind !== 'turn') {
        throw new GatewayPersistenceError(
          'invalid_event_sequence',
          'Non-turn operation unexpectedly owns an assistant message',
        );
      }
      if (['pending', 'streaming'].includes(assistant.status)) {
        if (eventIntent.status === 'completed') {
          throw new GatewayPersistenceError(
            'invalid_event_sequence',
            'Completed assistant requires a durable lifecycle intent',
          );
        }
        if (assistant.content !== '') {
          throw new GatewayPersistenceError(
            'invalid_event_sequence',
            'Partial assistant content cannot be promoted by an event-only terminal',
          );
        }
        const [settled] = await transaction
          .update(conversationMessages)
          .set({
            status: eventIntent.status,
            failureCode:
              eventIntent.status === 'failed'
                ? eventIntent.code
                : eventIntent.status === 'cancelled'
                  ? 'CANCELLED'
                  : null,
            completedAt: now,
          })
          .where(
            and(
              eq(conversationMessages.id, assistant.id),
              inArray(conversationMessages.status, ['pending', 'streaming']),
            ),
          )
          .returning({ id: conversationMessages.id });
        if (!settled) {
          throw new GatewayPersistenceError(
            'invalid_event_sequence',
            'Assistant changed during terminal reconciliation',
          );
        }
      } else if (!assistantMatchesIntent(assistant, eventIntent)) {
        throw new GatewayPersistenceError(
          'invalid_event_sequence',
          'Assistant and operation terminal facts conflict',
        );
      }
    }
    return operationStatus;
  }

  if (!assistantMatchesIntent(assistant, intent)) {
    throw new GatewayPersistenceError(
      'invalid_event_sequence',
      'Gateway terminal intent does not match assistant settlement',
    );
  }
  if (
    terminalEvents.length > 1 ||
    (terminalEvents[0] &&
      !gatewayTerminalEventMatchesIntent(terminalEvents[0], intent))
  ) {
    throw new GatewayPersistenceError(
      'invalid_event_sequence',
      'Gateway terminal facts conflict',
    );
  }
  if (operationStatus !== 'running') {
    if (!terminalEvents[0]) {
      throw new GatewayPersistenceError(
        'invalid_event_sequence',
        'Terminal operation is missing its event',
      );
    }
    return intent.status;
  }
  if (terminalEvents[0]) {
    throw new GatewayPersistenceError(
      'invalid_event_sequence',
      'Running operation already has a terminal event',
    );
  }
  await appendGatewayOperationEvent(
    transaction,
    operationId,
    terminalPayload(intent),
    now,
  );
  return intent.status;
}
