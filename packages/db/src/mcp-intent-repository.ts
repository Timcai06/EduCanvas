import { and, eq, inArray } from 'drizzle-orm';
import { getDb } from './client';
import { isUuid } from './internal/identifiers';
import { agentOperations, toolCalls } from './schema';
import { mcpToolIntents } from './schema/mcp-intent';

type Database = ReturnType<typeof getDb>;
type IntentStatus =
  'prepared' | 'dispatching' | 'completed' | 'failed' | 'outcome_unknown';
type TerminalIntentStatus = Extract<
  IntentStatus,
  'completed' | 'failed' | 'outcome_unknown'
>;

export interface McpIntentMetadataRecord {
  resumeRef: string;
  operationId: string;
  toolCallId: string;
  actorId: string;
  agentId: string;
  serverId: string;
  remoteToolName: string;
  modelToolName: string;
  capability: 'external.mcp.invoke';
  risk: 'l2' | 'l3';
  effect: 'write';
  semanticsHash: string;
  expiresAt: string;
}

export interface McpSealedIntentRecord {
  keyVersion: 'v1';
  nonce: string;
  ciphertext: string;
  authTag: string;
  payloadHash: string;
}

export interface McpDurableIntentRecord extends McpIntentMetadataRecord {
  status: IntentStatus;
  sealedPayload: McpSealedIntentRecord | null;
  preparedAt: string;
  dispatchStartedAt: string | null;
  settledAt: string | null;
}

export class McpIntentOwnershipError extends Error {
  readonly code = 'mcp_intent_not_found';
  constructor() {
    super('MCP意图不存在或不属于当前执行范围');
    this.name = 'McpIntentOwnershipError';
  }
}

export class McpIntentConflictError extends Error {
  readonly code = 'mcp_intent_conflict';
  constructor() {
    super('MCP恢复引用已绑定不同意图');
    this.name = 'McpIntentConflictError';
  }
}

export class McpIntentLifecycleError extends Error {
  readonly code = 'invalid_mcp_intent_transition';
  constructor(message: string) {
    super(message);
    this.name = 'McpIntentLifecycleError';
  }
}

function safeText(value: string, max: number): boolean {
  return (
    value.length >= 1 &&
    value.length <= max &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

function validateMetadata(value: McpIntentMetadataRecord): void {
  const expiresAt = new Date(value.expiresAt);
  if (
    !/^mcp\.intent:[a-f0-9]{64}$/.test(value.resumeRef) ||
    !isUuid(value.operationId) ||
    !isUuid(value.toolCallId) ||
    !isUuid(value.agentId) ||
    !safeText(value.actorId, 160) ||
    !safeText(value.serverId, 64) ||
    !safeText(value.remoteToolName, 128) ||
    !safeText(value.modelToolName, 64) ||
    value.capability !== 'external.mcp.invoke' ||
    !['l2', 'l3'].includes(value.risk) ||
    value.effect !== 'write' ||
    !/^[a-f0-9]{64}$/.test(value.semanticsHash) ||
    Number.isNaN(expiresAt.getTime())
  ) {
    throw new McpIntentLifecycleError('MCP意图元数据无效');
  }
}

function validateSealed(value: McpSealedIntentRecord): void {
  if (
    value.keyVersion !== 'v1' ||
    !/^[A-Za-z0-9+/]{16}={0,2}$/.test(value.nonce) ||
    !/^[A-Za-z0-9+/]{22}={0,2}$/.test(value.authTag) ||
    value.ciphertext.length < 1 ||
    value.ciphertext.length > 350_000 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(value.ciphertext) ||
    !/^[a-f0-9]{64}$/.test(value.payloadHash)
  ) {
    throw new McpIntentLifecycleError('MCP意图密文无效');
  }
}

function toRecord(
  row: typeof mcpToolIntents.$inferSelect,
): McpDurableIntentRecord {
  const hasCipher =
    row.keyVersion === 'v1' && row.nonce && row.ciphertext && row.authTag;
  return {
    resumeRef: row.resumeRef,
    operationId: row.operationId,
    toolCallId: row.toolCallId,
    actorId: row.actorUserId,
    agentId: row.agentId,
    serverId: row.serverId,
    remoteToolName: row.remoteToolName,
    modelToolName: row.modelToolName,
    capability: row.capability as 'external.mcp.invoke',
    risk: row.risk as 'l2' | 'l3',
    effect: 'write',
    semanticsHash: row.semanticsHash,
    expiresAt: row.expiresAt.toISOString(),
    status: row.status as IntentStatus,
    sealedPayload: hasCipher
      ? {
          keyVersion: 'v1',
          nonce: row.nonce!,
          ciphertext: row.ciphertext!,
          authTag: row.authTag!,
          payloadHash: row.payloadHash,
        }
      : null,
    preparedAt: row.preparedAt.toISOString(),
    dispatchStartedAt: row.dispatchStartedAt?.toISOString() ?? null,
    settledAt: row.settledAt?.toISOString() ?? null,
  };
}

function sameIntent(
  row: typeof mcpToolIntents.$inferSelect,
  metadata: McpIntentMetadataRecord,
  payloadHash: string,
): boolean {
  return (
    row.operationId === metadata.operationId &&
    row.toolCallId === metadata.toolCallId &&
    row.actorUserId === metadata.actorId &&
    row.agentId === metadata.agentId &&
    row.serverId === metadata.serverId &&
    row.remoteToolName === metadata.remoteToolName &&
    row.modelToolName === metadata.modelToolName &&
    row.capability === metadata.capability &&
    row.risk === metadata.risk &&
    row.semanticsHash === metadata.semanticsHash &&
    row.expiresAt.toISOString() === metadata.expiresAt &&
    row.payloadHash === payloadHash
  );
}

/** MCP Adapter的PostgreSQL密文仓储；领取前不暴露参数，发起外呼前立即擦除密文。 */
export class DrizzleMcpIntentRepository {
  constructor(private readonly providedDatabase?: Database) {}
  private get database(): Database {
    return this.providedDatabase ?? getDb();
  }

  async prepare(input: {
    metadata: McpIntentMetadataRecord;
    sealedPayload: McpSealedIntentRecord;
    now?: Date;
  }): Promise<{ intent: McpDurableIntentRecord; replayed: boolean }> {
    validateMetadata(input.metadata);
    validateSealed(input.sealedPayload);
    const expiresAt = new Date(input.metadata.expiresAt);
    const now = input.now ?? new Date();
    if (
      expiresAt <= now ||
      expiresAt.getTime() > now.getTime() + 24 * 60 * 60_000
    ) {
      throw new McpIntentLifecycleError('MCP意图过期时间无效');
    }
    return this.database.transaction(async (transaction) => {
      const [scope] = await transaction
        .select({ operationId: agentOperations.id })
        .from(toolCalls)
        .innerJoin(
          agentOperations,
          eq(agentOperations.id, toolCalls.agentOperationId),
        )
        .where(
          and(
            eq(toolCalls.id, input.metadata.toolCallId),
            eq(toolCalls.agentOperationId, input.metadata.operationId),
            eq(toolCalls.status, 'pending'),
            eq(toolCalls.effect, 'write'),
            eq(agentOperations.actorUserId, input.metadata.actorId),
            eq(agentOperations.agentId, input.metadata.agentId),
            eq(agentOperations.status, 'running'),
          ),
        )
        .limit(1);
      if (!scope) throw new McpIntentOwnershipError();
      const [existing] = await transaction
        .select()
        .from(mcpToolIntents)
        .where(eq(mcpToolIntents.resumeRef, input.metadata.resumeRef))
        .limit(1);
      if (existing) {
        if (
          !sameIntent(existing, input.metadata, input.sealedPayload.payloadHash)
        ) {
          throw new McpIntentConflictError();
        }
        return { intent: toRecord(existing), replayed: true };
      }
      const [created] = await transaction
        .insert(mcpToolIntents)
        .values({
          resumeRef: input.metadata.resumeRef,
          operationId: input.metadata.operationId,
          toolCallId: input.metadata.toolCallId,
          actorUserId: input.metadata.actorId,
          agentId: input.metadata.agentId,
          serverId: input.metadata.serverId,
          remoteToolName: input.metadata.remoteToolName,
          modelToolName: input.metadata.modelToolName,
          capability: input.metadata.capability,
          risk: input.metadata.risk,
          effect: 'write',
          semanticsHash: input.metadata.semanticsHash,
          keyVersion: input.sealedPayload.keyVersion,
          nonce: input.sealedPayload.nonce,
          ciphertext: input.sealedPayload.ciphertext,
          authTag: input.sealedPayload.authTag,
          payloadHash: input.sealedPayload.payloadHash,
          expiresAt,
          preparedAt: now,
        })
        .onConflictDoNothing()
        .returning();
      if (created) return { intent: toRecord(created), replayed: false };
      const [concurrent] = await transaction
        .select()
        .from(mcpToolIntents)
        .where(eq(mcpToolIntents.resumeRef, input.metadata.resumeRef))
        .limit(1);
      if (
        !concurrent ||
        !sameIntent(concurrent, input.metadata, input.sealedPayload.payloadHash)
      ) {
        throw new McpIntentConflictError();
      }
      return { intent: toRecord(concurrent), replayed: true };
    });
  }

  async getForResume(input: {
    resumeRef: string;
    operationId: string;
    toolCallId: string;
    actorId: string;
    agentId: string;
    capability: string;
  }): Promise<McpDurableIntentRecord> {
    const [row] = await this.database
      .select()
      .from(mcpToolIntents)
      .where(
        and(
          eq(mcpToolIntents.resumeRef, input.resumeRef),
          eq(mcpToolIntents.operationId, input.operationId),
          eq(mcpToolIntents.toolCallId, input.toolCallId),
          eq(mcpToolIntents.actorUserId, input.actorId),
          eq(mcpToolIntents.agentId, input.agentId),
          eq(mcpToolIntents.capability, input.capability),
        ),
      )
      .limit(1);
    if (!row) throw new McpIntentOwnershipError();
    return toRecord(row);
  }

  async markDispatching(input: {
    resumeRef: string;
    operationId: string;
    actorId: string;
  }) {
    const now = new Date();
    const [updated] = await this.database
      .update(mcpToolIntents)
      .set({
        status: 'dispatching',
        dispatchStartedAt: now,
        keyVersion: null,
        nonce: null,
        ciphertext: null,
        authTag: null,
      })
      .where(
        and(
          eq(mcpToolIntents.resumeRef, input.resumeRef),
          eq(mcpToolIntents.operationId, input.operationId),
          eq(mcpToolIntents.actorUserId, input.actorId),
          eq(mcpToolIntents.status, 'prepared'),
        ),
      )
      .returning();
    if (updated) return { intent: toRecord(updated), transitioned: true };
    const current = await this.requireOwned(input);
    return { intent: toRecord(current), transitioned: false };
  }

  async settle(input: {
    resumeRef: string;
    operationId: string;
    actorId: string;
    status: TerminalIntentStatus;
  }) {
    const sources =
      input.status === 'failed' ? ['prepared', 'dispatching'] : ['dispatching'];
    const [updated] = await this.database
      .update(mcpToolIntents)
      .set({
        status: input.status,
        keyVersion: null,
        nonce: null,
        ciphertext: null,
        authTag: null,
        settledAt: new Date(),
      })
      .where(
        and(
          eq(mcpToolIntents.resumeRef, input.resumeRef),
          eq(mcpToolIntents.operationId, input.operationId),
          eq(mcpToolIntents.actorUserId, input.actorId),
          inArray(mcpToolIntents.status, sources),
        ),
      )
      .returning();
    if (updated) return { intent: toRecord(updated), transitioned: true };
    const current = await this.requireOwned(input);
    return { intent: toRecord(current), transitioned: false };
  }

  private async requireOwned(input: {
    resumeRef: string;
    operationId: string;
    actorId: string;
  }) {
    const [row] = await this.database
      .select()
      .from(mcpToolIntents)
      .where(
        and(
          eq(mcpToolIntents.resumeRef, input.resumeRef),
          eq(mcpToolIntents.operationId, input.operationId),
          eq(mcpToolIntents.actorUserId, input.actorId),
        ),
      )
      .limit(1);
    if (!row) throw new McpIntentOwnershipError();
    return row;
  }
}
