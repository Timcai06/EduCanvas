import { gatewayOperationEventSchema } from '@educanvas/gateway-core';
import type { AgentMessagePart } from '@educanvas/agent-core';
import { and, asc, eq, inArray, isNull, or } from 'drizzle-orm';
import type { getDb } from './client';
import {
  encodeGatewayTerminalIntent,
  gatewayTerminalEventMatchesIntent,
  type DurableGatewayTerminalIntent,
} from './gateway/terminal-reconciliation';
import {
  agentOperations,
  assetVersions,
  conversationMessageCitations,
  conversationMessages,
  conversations,
  gatewayOperationEvents,
  operationSources,
} from './schema';
import type { PlatformTurnSnapshot } from './platform-turn-repository';

type Database = ReturnType<typeof getDb>;
type DatabaseTransaction = Parameters<
  Parameters<Database['transaction']>[0]
>[0];
type DatabaseExecutor = Database | DatabaseTransaction;

export function samePlatformMessageParts(
  left: readonly AgentMessagePart[],
  right: readonly AgentMessagePart[],
): boolean {
  if (left.length !== right.length) return false;
  return left.every((part, index) => {
    const candidate = right[index];
    if (!candidate || part.type !== candidate.type) return false;
    if (part.type === 'text' && candidate.type === 'text') {
      return part.text === candidate.text;
    }
    if (part.type === 'asset_ref' && candidate.type === 'asset_ref') {
      return (
        part.usage === candidate.usage &&
        part.reference.assetId === candidate.reference.assetId &&
        part.reference.versionId === candidate.reference.versionId &&
        part.reference.kind === candidate.reference.kind
      );
    }
    if (part.type === 'artifact_ref' && candidate.type === 'artifact_ref') {
      return (
        part.artifactId === candidate.artifactId &&
        part.versionId === candidate.versionId &&
        part.kind === candidate.kind
      );
    }
    return false;
  });
}

interface SettlementDependencies {
  database: Database;
  requireConversationAccess: (
    executor: DatabaseExecutor,
    conversationId: string,
    trustedSubjectId: string,
  ) => Promise<unknown>;
  loadTurn: (
    executor: DatabaseExecutor,
    operationId: string,
    replayed: boolean,
  ) => Promise<PlatformTurnSnapshot>;
  ownershipError: () => Error;
  lifecycleError: (message: string) => Error;
}

export type PlatformTurnTerminalStatus =
  'completed' | 'failed' | 'cancelled' | 'interrupted';

/** 与Message终态在同一事务插入的网页引用，避免提交后再查询制造伪失败。 */
export interface PlatformSettledCitationSnapshot {
  citationId: string;
  assistantMessageId: string;
  ordinal: number;
  assetId: string;
  assetVersionId: string;
  label: string;
  url: string;
}

export interface PlatformTurnSettlementSnapshot extends PlatformTurnSnapshot {
  settledCitations: readonly PlatformSettledCitationSnapshot[];
}

export interface SettlePlatformTurnInput {
  conversationId: string;
  trustedSubjectId: string;
  turnId: string;
  status: PlatformTurnTerminalStatus;
  content: string;
  failureCode?: string | null;
  sourceMarkers?: readonly number[];
  operationTerminalWriter?: 'turn_application' | 'gateway';
  gatewayTerminalIntent?: DurableGatewayTerminalIntent;
  now?: Date;
}

async function loadSettledCitations(
  executor: DatabaseExecutor,
  input: { assistantMessageId: string; operationId: string },
): Promise<PlatformSettledCitationSnapshot[]> {
  return executor
    .select({
      citationId: conversationMessageCitations.id,
      assistantMessageId: conversationMessageCitations.assistantMessageId,
      ordinal: operationSources.ordinal,
      assetId: assetVersions.assetId,
      assetVersionId: operationSources.assetVersionId,
      label: operationSources.label,
      url: operationSources.locatorUrl,
    })
    .from(conversationMessageCitations)
    .innerJoin(
      operationSources,
      eq(operationSources.id, conversationMessageCitations.operationSourceId),
    )
    .innerJoin(
      assetVersions,
      eq(assetVersions.id, operationSources.assetVersionId),
    )
    .where(
      and(
        eq(
          conversationMessageCitations.assistantMessageId,
          input.assistantMessageId,
        ),
        eq(operationSources.operationId, input.operationId),
      ),
    )
    .orderBy(asc(operationSources.ordinal));
}

/**
 * Executes message settlement, citation freezing, and durable Gateway intent in
 * one transaction. Ownership and snapshot loading remain repository policy.
 */
export async function settlePlatformTurn(
  input: SettlePlatformTurnInput,
  dependencies: SettlementDependencies,
): Promise<PlatformTurnSettlementSnapshot> {
  const sourceMarkers = input.sourceMarkers ?? [];
  const validMarkers = sourceMarkers.every(
    (marker, index) =>
      Number.isInteger(marker) &&
      marker >= 1 &&
      marker <= 99 &&
      (index === 0 || marker > sourceMarkers[index - 1]!),
  );
  if (
    !validMarkers ||
    (input.status !== 'completed' && sourceMarkers.length > 0)
  ) {
    throw dependencies.lifecycleError('通用Turn引用编号无效');
  }
  const now = input.now ?? new Date();
  return dependencies.database.transaction(async (transaction) => {
    await dependencies.requireConversationAccess(
      transaction,
      input.conversationId,
      input.trustedSubjectId,
    );
    const [operation] = await transaction
      .select({
        id: agentOperations.id,
        cancelRequestedAt: agentOperations.cancelRequestedAt,
        failureCode: agentOperations.failureCode,
        gatewayEnvelopeId: agentOperations.gatewayEnvelopeId,
        status: agentOperations.status,
      })
      .from(agentOperations)
      .where(
        and(
          eq(agentOperations.id, input.turnId),
          eq(agentOperations.conversationId, input.conversationId),
          eq(agentOperations.kind, 'turn'),
          or(
            eq(agentOperations.actorUserId, input.trustedSubjectId),
            isNull(agentOperations.actorUserId),
          ),
        ),
      )
      .limit(1);
    if (!operation) throw dependencies.ownershipError();
    if (input.status === 'cancelled' && !operation.cancelRequestedAt) {
      throw dependencies.lifecycleError(
        '只有已请求取消的通用Turn才能进入cancelled终态',
      );
    }
    const gatewayOwnsTerminal = input.operationTerminalWriter === 'gateway';
    const gatewayAttached = operation.gatewayEnvelopeId !== null;
    if (gatewayOwnsTerminal && !gatewayAttached) {
      throw dependencies.lifecycleError(
        '只有Gateway附着Turn可以把Operation终态交给Gateway',
      );
    }
    if (gatewayAttached && !gatewayOwnsTerminal) {
      throw dependencies.lifecycleError(
        'Gateway附着Turn只能由Gateway写入Operation终态',
      );
    }
    if (gatewayOwnsTerminal) {
      const intent = input.gatewayTerminalIntent;
      const normalizedInputStatus =
        input.status === 'interrupted' ? 'failed' : input.status;
      if (!intent || intent.status !== normalizedInputStatus) {
        throw dependencies.lifecycleError(
          'Gateway附着Turn必须提供匹配的terminal intent',
        );
      }
      if (!['pending', 'running'].includes(operation.status)) {
        const terminalRows = await transaction
          .select({ payload: gatewayOperationEvents.payload })
          .from(gatewayOperationEvents)
          .where(
            and(
              eq(gatewayOperationEvents.operationId, input.turnId),
              inArray(gatewayOperationEvents.type, [
                'operation.completed',
                'operation.failed',
                'operation.cancelled',
              ]),
            ),
          );
        const terminalEvents = terminalRows.map(({ payload }) =>
          gatewayOperationEventSchema.parse(payload),
        );
        if (
          terminalEvents.length !== 1 ||
          !gatewayTerminalEventMatchesIntent(terminalEvents[0]!, intent)
        ) {
          throw dependencies.lifecycleError(
            'Gateway Operation终态与assistant结算意图冲突',
          );
        }
      }
    }

    let settleMessage = false;
    const settledCitations: PlatformSettledCitationSnapshot[] = [];
    if (gatewayOwnsTerminal) {
      const normalizedOperationStatus =
        operation.status === 'interrupted' ? 'failed' : operation.status;
      settleMessage =
        ['pending', 'running'].includes(operation.status) ||
        normalizedOperationStatus === input.status;
    } else {
      const [updated] = await transaction
        .update(agentOperations)
        .set({
          status: input.status,
          failureCode: input.failureCode ?? null,
          completedAt: now,
        })
        .where(
          and(
            eq(agentOperations.id, input.turnId),
            inArray(agentOperations.status, ['pending', 'running']),
          ),
        )
        .returning({ id: agentOperations.id });
      settleMessage = Boolean(updated);
    }

    if (settleMessage) {
      const [assistant] = await transaction
        .select({
          id: conversationMessages.id,
          status: conversationMessages.status,
          content: conversationMessages.content,
          failureCode: conversationMessages.failureCode,
        })
        .from(conversationMessages)
        .where(
          and(
            eq(conversationMessages.operationId, input.turnId),
            eq(conversationMessages.role, 'assistant'),
          ),
        )
        .limit(1);
      if (!assistant) {
        throw dependencies.lifecycleError('通用Turn缺少assistant消息');
      }
      const assistantAlreadyTerminal = !['pending', 'streaming'].includes(
        assistant.status,
      );
      if (assistantAlreadyTerminal) {
        const sameTerminal =
          assistant.status === input.status &&
          assistant.content === input.content &&
          assistant.failureCode === (input.failureCode ?? null);
        if (!sameTerminal) {
          throw dependencies.lifecycleError('重复结算与已有assistant终态冲突');
        }
        const existingCitations = await loadSettledCitations(transaction, {
          assistantMessageId: assistant.id,
          operationId: input.turnId,
        });
        if (
          existingCitations.length !== sourceMarkers.length ||
          existingCitations.some(
            (citation, index) => citation.ordinal !== sourceMarkers[index],
          )
        ) {
          throw dependencies.lifecycleError('重复结算与已有引用事实冲突');
        }
        settledCitations.push(...existingCitations);
        if (
          gatewayOwnsTerminal &&
          ['pending', 'running'].includes(operation.status)
        ) {
          const encodedIntent = encodeGatewayTerminalIntent(
            input.gatewayTerminalIntent!,
          );
          if (
            operation.failureCode !== null &&
            operation.failureCode !== encodedIntent
          ) {
            throw dependencies.lifecycleError(
              '重复结算与已有Gateway terminal intent冲突',
            );
          }
          const [intentPersisted] = await transaction
            .update(agentOperations)
            .set({ failureCode: encodedIntent })
            .where(
              and(
                eq(agentOperations.id, input.turnId),
                inArray(agentOperations.status, ['pending', 'running']),
                operation.failureCode === null
                  ? isNull(agentOperations.failureCode)
                  : eq(agentOperations.failureCode, encodedIntent),
              ),
            )
            .returning({ id: agentOperations.id });
          if (!intentPersisted) {
            throw dependencies.lifecycleError(
              'Gateway terminal intent无法与重复assistant终态共同提交',
            );
          }
        }
        return {
          ...(await dependencies.loadTurn(transaction, input.turnId, false)),
          settledCitations,
        };
      }

      if (sourceMarkers.length > 0) {
        const citedSources = await transaction
          .select({
            id: operationSources.id,
            ordinal: operationSources.ordinal,
            assetId: assetVersions.assetId,
            assetVersionId: operationSources.assetVersionId,
            label: operationSources.label,
            url: operationSources.locatorUrl,
          })
          .from(operationSources)
          .innerJoin(
            assetVersions,
            eq(assetVersions.id, operationSources.assetVersionId),
          )
          .where(
            and(
              eq(operationSources.operationId, input.turnId),
              inArray(operationSources.ordinal, [...sourceMarkers]),
            ),
          )
          .orderBy(asc(operationSources.ordinal));
        if (
          citedSources.length !== sourceMarkers.length ||
          citedSources.some(
            (source, index) => source.ordinal !== sourceMarkers[index],
          )
        ) {
          throw dependencies.lifecycleError('通用Turn引用不属于本轮来源白名单');
        }
        const inserted = await transaction
          .insert(conversationMessageCitations)
          .values(
            citedSources.map((source) => ({
              assistantMessageId: assistant.id,
              operationSourceId: source.id,
              createdAt: now,
            })),
          )
          .returning({
            citationId: conversationMessageCitations.id,
            operationSourceId: conversationMessageCitations.operationSourceId,
          });
        const citationIds = new Map(
          inserted.map((citation) => [
            citation.operationSourceId,
            citation.citationId,
          ]),
        );
        settledCitations.push(
          ...citedSources.map((source) => {
            const citationId = citationIds.get(source.id);
            if (!citationId) {
              throw dependencies.lifecycleError('通用Turn引用写入结果不完整');
            }
            return {
              citationId,
              assistantMessageId: assistant.id,
              ordinal: source.ordinal,
              assetId: source.assetId,
              assetVersionId: source.assetVersionId,
              label: source.label,
              url: source.url,
            };
          }),
        );
      }

      const [updatedAssistant] = await transaction
        .update(conversationMessages)
        .set({
          status: input.status,
          content: input.content,
          failureCode: input.failureCode ?? null,
          completedAt: now,
        })
        .where(
          and(
            eq(conversationMessages.operationId, input.turnId),
            eq(conversationMessages.role, 'assistant'),
            inArray(conversationMessages.status, ['pending', 'streaming']),
          ),
        )
        .returning({ id: conversationMessages.id });
      if (!updatedAssistant) {
        throw dependencies.lifecycleError(
          'assistant消息被并发结算，请重试读取持久终态',
        );
      }
      if (
        gatewayOwnsTerminal &&
        ['pending', 'running'].includes(operation.status)
      ) {
        const [intentPersisted] = await transaction
          .update(agentOperations)
          .set({
            failureCode: encodeGatewayTerminalIntent(
              input.gatewayTerminalIntent!,
            ),
          })
          .where(
            and(
              eq(agentOperations.id, input.turnId),
              inArray(agentOperations.status, ['pending', 'running']),
            ),
          )
          .returning({ id: agentOperations.id });
        if (!intentPersisted) {
          throw dependencies.lifecycleError(
            'Gateway terminal intent无法与assistant终态共同提交',
          );
        }
      }
      await transaction
        .update(conversations)
        .set({ lastActivityAt: now, updatedAt: now })
        .where(eq(conversations.id, input.conversationId));
    }
    return {
      ...(await dependencies.loadTurn(transaction, input.turnId, false)),
      settledCitations,
    };
  });
}
