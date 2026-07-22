import type {
  PrepareToolApprovalIntentInput,
  ToolApprovalIntentPort,
  ToolApprovalIntentSnapshot,
} from '@educanvas/agent-core';
import {
  prepareToolApprovalIntentInputSchema,
  toolApprovalIntentProtocolVersion,
  toolApprovalIntentSnapshotSchema,
} from '@educanvas/agent-core';
import { and, eq, or, sql } from 'drizzle-orm';
import { getDb } from './client';
import { isUuid } from './internal/identifiers';
import { agentOperations, toolApprovalIntents, toolCalls } from './schema';

type Database = ReturnType<typeof getDb>;

/** 对不存在与跨Actor访问使用同一错误，避免泄漏Operation或Tool Call身份。 */
export class ToolApprovalIntentOwnershipError extends Error {
  readonly code = 'tool_approval_intent_not_found';

  constructor() {
    super('Tool approval intent不存在或不属于当前Actor');
    this.name = 'ToolApprovalIntentOwnershipError';
  }
}

/** approval、Tool Call或Adapter恢复引用已绑定不同语义。 */
export class ToolApprovalIntentConflictError extends Error {
  readonly code = 'tool_approval_intent_conflict';

  constructor() {
    super('Tool approval intent已绑定不同恢复语义');
    this.name = 'ToolApprovalIntentConflictError';
  }
}

/** 输入或Operation状态不允许继续准备审批。 */
export class ToolApprovalIntentLifecycleError extends Error {
  readonly code = 'invalid_tool_approval_intent_transition';

  constructor(message: string) {
    super(message);
    this.name = 'ToolApprovalIntentLifecycleError';
  }
}

function toSnapshot(
  row: typeof toolApprovalIntents.$inferSelect,
): ToolApprovalIntentSnapshot {
  return toolApprovalIntentSnapshotSchema.parse({
    protocol: row.protocolVersion,
    operationId: row.operationId,
    actorId: row.actorUserId,
    approvalId: row.approvalId,
    status: row.status,
    expiresAt: row.expiresAt.toISOString(),
    work: {
      kind: 'tool_invocation',
      step: 'tool.invoke',
      toolCallId: row.toolCallId,
      adapterSource: row.adapterSource,
      resumeRef: row.resumeRef,
    },
    preparedAt: row.preparedAt.toISOString(),
    boundAt: row.boundAt?.toISOString() ?? null,
    abandonedAt: row.abandonedAt?.toISOString() ?? null,
  });
}

function matches(
  row: typeof toolApprovalIntents.$inferSelect,
  input: PrepareToolApprovalIntentInput,
): boolean {
  return (
    row.operationId === input.operationId &&
    row.actorUserId === input.actorId &&
    row.approvalId === input.approvalId &&
    row.toolCallId === input.work.toolCallId &&
    row.adapterSource === input.work.adapterSource &&
    row.resumeRef === input.work.resumeRef &&
    row.expiresAt.getTime() === new Date(input.expiresAt).getTime()
  );
}

/**
 * Adapter侧的通用审批意图仓储。prepare只写最小恢复引用；Gateway随后在自己的
 * 事务中把prepared意图绑定为Approval与continuation，Adapter不能直接创建公开审批。
 */
export class DrizzleToolApprovalIntentRepository implements ToolApprovalIntentPort {
  constructor(private readonly providedDatabase?: Database) {}

  private get database(): Database {
    return this.providedDatabase ?? getDb();
  }

  async prepare(
    rawInput: PrepareToolApprovalIntentInput & { now?: Date },
  ): Promise<{ intent: ToolApprovalIntentSnapshot; replayed: boolean }> {
    const { now: _now, ...payload } = rawInput;
    const input = prepareToolApprovalIntentInputSchema.parse(payload);
    if (!isUuid(input.operationId) || !isUuid(input.work.toolCallId)) {
      throw new ToolApprovalIntentLifecycleError(
        'Operation与Tool Call必须使用UUID',
      );
    }
    if (input.actorId.length > 160) {
      throw new ToolApprovalIntentOwnershipError();
    }
    const now = rawInput.now ?? new Date();
    const expiresAt = new Date(input.expiresAt);
    if (
      expiresAt.getTime() <= now.getTime() ||
      expiresAt.getTime() > now.getTime() + 24 * 60 * 60_000
    ) {
      throw new ToolApprovalIntentLifecycleError(
        '审批意图必须在未来24小时内过期',
      );
    }

    return this.database.transaction(async (transaction) => {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`tool-approval-intent-v1:${input.operationId}`}, 0))`,
      );
      const [operation] = await transaction
        .select({
          id: agentOperations.id,
          status: agentOperations.status,
          cancelRequestedAt: agentOperations.cancelRequestedAt,
        })
        .from(agentOperations)
        .where(
          and(
            eq(agentOperations.id, input.operationId),
            eq(agentOperations.actorUserId, input.actorId),
            eq(agentOperations.kind, 'turn'),
          ),
        )
        .limit(1);
      if (!operation) throw new ToolApprovalIntentOwnershipError();
      if (operation.status !== 'running' || operation.cancelRequestedAt) {
        throw new ToolApprovalIntentLifecycleError(
          '只有未取消的running Operation可以准备审批意图',
        );
      }
      const [call] = await transaction
        .select({ id: toolCalls.id })
        .from(toolCalls)
        .where(
          and(
            eq(toolCalls.id, input.work.toolCallId),
            eq(toolCalls.agentOperationId, input.operationId),
            eq(toolCalls.status, 'pending'),
          ),
        )
        .limit(1);
      if (!call) throw new ToolApprovalIntentOwnershipError();

      const conflicts = await transaction
        .select()
        .from(toolApprovalIntents)
        .where(
          or(
            eq(toolApprovalIntents.approvalId, input.approvalId),
            eq(toolApprovalIntents.toolCallId, input.work.toolCallId),
            and(
              eq(toolApprovalIntents.adapterSource, input.work.adapterSource),
              eq(toolApprovalIntents.resumeRef, input.work.resumeRef),
            ),
          ),
        );
      if (conflicts.length > 0) {
        const existing = conflicts.find((row) => matches(row, input));
        if (!existing || existing.status === 'abandoned') {
          throw new ToolApprovalIntentConflictError();
        }
        return { intent: toSnapshot(existing), replayed: true };
      }

      const [created] = await transaction
        .insert(toolApprovalIntents)
        .values({
          approvalId: input.approvalId,
          operationId: input.operationId,
          actorUserId: input.actorId,
          protocolVersion: toolApprovalIntentProtocolVersion,
          toolCallId: input.work.toolCallId,
          adapterSource: input.work.adapterSource,
          resumeRef: input.work.resumeRef,
          status: 'prepared',
          expiresAt,
          preparedAt: now,
        })
        .onConflictDoNothing()
        .returning();
      if (!created) throw new ToolApprovalIntentConflictError();
      return { intent: toSnapshot(created), replayed: false };
    });
  }
}
