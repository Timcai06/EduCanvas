import { and, asc, desc, eq, gt, isNull, lte, sql } from 'drizzle-orm';
import {
  gatewayNodeHeartbeatSchema,
  gatewayNodeInvocationRequestSchema,
  gatewayNodeInvocationResultSchema,
  gatewayNodePairingRequestSchema,
  type GatewayNodeInvocationRequest,
  type GatewayNodeInvocationResult,
  type GatewayNodePairingRecord,
} from '@educanvas/gateway-core';
import { getDb } from '../client';
import {
  agentOperations,
  gatewayNodeInvocations,
  gatewayNodePairings,
} from '../schema';
import { ensurePersonalIdentity } from './identity-repository';
import { GatewayPersistenceError, type Database } from './persistence';

export type GatewayInvokableNodeCapability =
  GatewayNodeInvocationRequest['capability'];

export type GatewayNodeInvocationOutcome =
  | { status: 'pending' }
  | { status: 'expired' }
  | { status: 'settled'; result: GatewayNodeInvocationResult };

/** 心跳能力比对需要与批准能力做结构无关的稳定比较，故对键排序后规范化序列化。 */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function projectInvocation(row: typeof gatewayNodeInvocations.$inferSelect) {
  return gatewayNodeInvocationRequestSchema.parse({
    requestId: row.requestId,
    operationId: row.operationId,
    nodeId: row.nodeId,
    capability: row.capability,
    parameters: row.parameters,
    nonce: row.nonce,
    issuedAt: row.issuedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  });
}

/**
 * Node 边界：配对、心跳、能力受限的调用入队/轮询/结算与吊销。
 * enqueue 的主体归属必须从 PostgreSQL 的 Operation 与 Pairing 事实同事务解析，调用方不得补传主体字段。
 */
export class DrizzleGatewayNodeRepository {
  constructor(private readonly providedDatabase?: Database) {}

  private get database(): Database {
    return this.providedDatabase ?? getDb();
  }

  async pair(input: {
    userId: string;
    request: unknown;
    now?: Date;
  }): Promise<GatewayNodePairingRecord> {
    const request = gatewayNodePairingRequestSchema.parse(input.request);
    const now = input.now ?? new Date();
    if (new Date(request.expiresAt).getTime() <= now.getTime()) {
      throw new GatewayPersistenceError('forbidden', 'Pairing request expired');
    }
    const allowed = request.requestedCapabilities.capabilities.every(
      (capability) =>
        capability.name === 'device.status' ||
        capability.name === 'filesystem.read_allowlisted',
    );
    if (!allowed) {
      throw new GatewayPersistenceError(
        'forbidden',
        'Pairing requested unsupported capabilities',
      );
    }
    return this.database.transaction(async (transaction) => {
      const identity = await ensurePersonalIdentity(transaction, {
        userId: input.userId,
        kind: 'registered',
        now,
      });
      const [row] = await transaction
        .insert(gatewayNodePairings)
        .values({
          userId: identity.userId,
          agentId: identity.agentId,
          displayName: request.displayName,
          devicePublicKey: request.devicePublicKey,
          approvedCapabilities: request.requestedCapabilities,
          status: 'active',
          pairedAt: now,
          lastSeenAt: now,
        })
        .returning();
      if (!row) {
        throw new GatewayPersistenceError(
          'operation_not_found',
          'Node pairing failed',
        );
      }
      return {
        pairingId: row.id,
        nodeId: row.nodeId,
        userId: row.userId,
        agentId: row.agentId,
        displayName: row.displayName,
        devicePublicKey: row.devicePublicKey,
        approvedCapabilities: row.approvedCapabilities,
        status: 'active',
        pairedAt: row.pairedAt.toISOString(),
        lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
        revokedAt: null,
      };
    });
  }

  async getActive(nodeId: string): Promise<GatewayNodePairingRecord | null> {
    const [row] = await this.database
      .select()
      .from(gatewayNodePairings)
      .where(eq(gatewayNodePairings.nodeId, nodeId))
      .limit(1);
    if (!row || row.status !== 'active' || row.revokedAt) return null;
    return {
      pairingId: row.id,
      nodeId: row.nodeId,
      userId: row.userId,
      agentId: row.agentId,
      displayName: row.displayName,
      devicePublicKey: row.devicePublicKey,
      approvedCapabilities: row.approvedCapabilities,
      status: 'active',
      pairedAt: row.pairedAt.toISOString(),
      lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
      revokedAt: null,
    };
  }

  async heartbeat(raw: unknown, now: Date = new Date()): Promise<void> {
    const heartbeat = gatewayNodeHeartbeatSchema.parse(raw);
    const pairing = await this.getActive(heartbeat.nodeId);
    if (
      !pairing ||
      canonicalJson(pairing.approvedCapabilities) !==
        canonicalJson(heartbeat.capabilities)
    ) {
      throw new GatewayPersistenceError('forbidden', 'Node heartbeat denied');
    }
    await this.database
      .update(gatewayNodePairings)
      .set({ lastSeenAt: now, status: 'active' })
      .where(eq(gatewayNodePairings.nodeId, heartbeat.nodeId));
  }

  /**
   * 返回Operation真实Actor/Agent当前拥有且近期心跳的Node能力。
   * activeAfter由调用方的在线策略给出；客户端manifest和Notebook owner都不能扩大结果。
   */
  async listAvailableCapabilitiesForOperation(input: {
    operationId: string;
    actorId: string;
    agentId: string;
    activeAfter: Date;
  }): Promise<readonly GatewayInvokableNodeCapability[]> {
    const rows = await this.database
      .select({
        approvedCapabilities: gatewayNodePairings.approvedCapabilities,
      })
      .from(agentOperations)
      .innerJoin(
        gatewayNodePairings,
        and(
          eq(gatewayNodePairings.userId, agentOperations.actorUserId),
          eq(gatewayNodePairings.agentId, agentOperations.agentId),
        ),
      )
      .where(
        and(
          eq(agentOperations.id, input.operationId),
          eq(agentOperations.actorUserId, input.actorId),
          eq(agentOperations.agentId, input.agentId),
          eq(agentOperations.status, 'running'),
          isNull(agentOperations.cancelRequestedAt),
          eq(gatewayNodePairings.status, 'active'),
          isNull(gatewayNodePairings.revokedAt),
          gt(gatewayNodePairings.lastSeenAt, input.activeAfter),
        ),
      );
    const available = new Set<GatewayInvokableNodeCapability>();
    for (const row of rows) {
      for (const capability of row.approvedCapabilities.capabilities) {
        if (
          capability.name === 'device.status' ||
          capability.name === 'filesystem.read_allowlisted'
        ) {
          available.add(capability.name);
        }
      }
    }
    return [...available].sort();
  }

  /**
   * Tool Kernel生产入口：从Operation归属选择近期在线的私人Node并幂等入队。
   * nodeId不会进入模型参数；同requestId只允许完全相同的调用语义。
   */
  async enqueueForOperation(input: {
    operationId: string;
    actorId: string;
    agentId: string;
    requestId: string;
    capability: GatewayInvokableNodeCapability;
    parameters: GatewayNodeInvocationRequest['parameters'];
    nonce: string;
    issuedAt: Date;
    expiresAt: Date;
    activeAfter: Date;
  }): Promise<GatewayNodeInvocationRequest> {
    return this.database.transaction(async (transaction) => {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`node-tool-invocation-v1:${input.requestId}`}, 0))`,
      );
      const [existing] = await transaction
        .select({ invocation: gatewayNodeInvocations })
        .from(gatewayNodeInvocations)
        .innerJoin(
          agentOperations,
          eq(agentOperations.id, gatewayNodeInvocations.operationId),
        )
        .where(eq(gatewayNodeInvocations.requestId, input.requestId))
        .limit(1);
      if (existing) {
        const request = projectInvocation(existing.invocation);
        if (
          request.operationId !== input.operationId ||
          request.capability !== input.capability ||
          request.nonce !== input.nonce ||
          canonicalJson(request.parameters) !== canonicalJson(input.parameters)
        ) {
          throw new GatewayPersistenceError(
            'idempotency_conflict',
            'Node invocation request conflicts with existing semantics',
          );
        }
        const [operation] = await transaction
          .select({
            actorId: agentOperations.actorUserId,
            agentId: agentOperations.agentId,
          })
          .from(agentOperations)
          .where(eq(agentOperations.id, input.operationId))
          .limit(1);
        if (
          !operation ||
          operation.actorId !== input.actorId ||
          operation.agentId !== input.agentId
        ) {
          throw new GatewayPersistenceError(
            'forbidden',
            'Node invocation ownership denied',
          );
        }
        return request;
      }

      const candidates = await transaction
        .select({ pairing: gatewayNodePairings })
        .from(agentOperations)
        .innerJoin(
          gatewayNodePairings,
          and(
            eq(gatewayNodePairings.userId, agentOperations.actorUserId),
            eq(gatewayNodePairings.agentId, agentOperations.agentId),
          ),
        )
        .where(
          and(
            eq(agentOperations.id, input.operationId),
            eq(agentOperations.actorUserId, input.actorId),
            eq(agentOperations.agentId, input.agentId),
            eq(agentOperations.status, 'running'),
            isNull(agentOperations.cancelRequestedAt),
            eq(gatewayNodePairings.status, 'active'),
            isNull(gatewayNodePairings.revokedAt),
            gt(gatewayNodePairings.lastSeenAt, input.activeAfter),
          ),
        )
        .orderBy(
          desc(gatewayNodePairings.lastSeenAt),
          asc(gatewayNodePairings.nodeId),
        )
        .for('update', { of: gatewayNodePairings });
      const selected = candidates.find(({ pairing }) =>
        pairing.approvedCapabilities.capabilities.some(
          (capability) => capability.name === input.capability,
        ),
      )?.pairing;
      if (!selected) {
        throw new GatewayPersistenceError(
          'forbidden',
          'No active owned Node provides the requested capability',
        );
      }
      const request = gatewayNodeInvocationRequestSchema.parse({
        requestId: input.requestId,
        operationId: input.operationId,
        nodeId: selected.nodeId,
        capability: input.capability,
        parameters: input.parameters,
        nonce: input.nonce,
        issuedAt: input.issuedAt.toISOString(),
        expiresAt: input.expiresAt.toISOString(),
      });
      await transaction.insert(gatewayNodeInvocations).values({
        requestId: request.requestId,
        operationId: request.operationId,
        nodeId: request.nodeId,
        capability: request.capability,
        parameters: request.parameters,
        nonce: request.nonce,
        status: 'pending',
        issuedAt: input.issuedAt,
        expiresAt: input.expiresAt,
      });
      return request;
    });
  }

  /** 读取Tool Kernel发起的调用结果；Operation主体不匹配时始终fail closed。 */
  async readInvocationOutcome(input: {
    operationId: string;
    actorId: string;
    agentId: string;
    requestId: string;
    now?: Date;
  }): Promise<GatewayNodeInvocationOutcome> {
    const now = input.now ?? new Date();
    return this.database.transaction(async (transaction) => {
      const [row] = await transaction
        .select({
          invocation: gatewayNodeInvocations,
          actorId: agentOperations.actorUserId,
          agentId: agentOperations.agentId,
        })
        .from(gatewayNodeInvocations)
        .innerJoin(
          agentOperations,
          eq(agentOperations.id, gatewayNodeInvocations.operationId),
        )
        .where(
          and(
            eq(gatewayNodeInvocations.requestId, input.requestId),
            eq(gatewayNodeInvocations.operationId, input.operationId),
          ),
        )
        .limit(1)
        .for('update', { of: gatewayNodeInvocations });
      if (
        !row ||
        row.actorId !== input.actorId ||
        row.agentId !== input.agentId
      ) {
        throw new GatewayPersistenceError(
          'forbidden',
          'Node invocation outcome ownership denied',
        );
      }
      if (
        row.invocation.status === 'pending' &&
        row.invocation.expiresAt.getTime() <= now.getTime()
      ) {
        await transaction
          .update(gatewayNodeInvocations)
          .set({ status: 'expired', completedAt: now })
          .where(
            and(
              eq(gatewayNodeInvocations.requestId, input.requestId),
              eq(gatewayNodeInvocations.status, 'pending'),
            ),
          );
        return { status: 'expired' };
      }
      if (row.invocation.status === 'pending') return { status: 'pending' };
      if (row.invocation.status === 'expired') return { status: 'expired' };
      const parsed = gatewayNodeInvocationResultSchema.safeParse(
        row.invocation.result,
      );
      if (!parsed.success) {
        throw new GatewayPersistenceError(
          'invalid_event_sequence',
          'Settled Node invocation has no valid result',
        );
      }
      return { status: 'settled', result: parsed.data };
    });
  }

  /** 取消或超时后只把仍pending的自有调用收敛为expired；已结算结果不回退。 */
  async expirePendingInvocation(input: {
    operationId: string;
    actorId: string;
    agentId: string;
    requestId: string;
    now?: Date;
  }): Promise<void> {
    const now = input.now ?? new Date();
    await this.database.transaction(async (transaction) => {
      const [row] = await transaction
        .select({
          actorId: agentOperations.actorUserId,
          agentId: agentOperations.agentId,
        })
        .from(gatewayNodeInvocations)
        .innerJoin(
          agentOperations,
          eq(agentOperations.id, gatewayNodeInvocations.operationId),
        )
        .where(
          and(
            eq(gatewayNodeInvocations.requestId, input.requestId),
            eq(gatewayNodeInvocations.operationId, input.operationId),
          ),
        )
        .limit(1);
      if (
        !row ||
        row.actorId !== input.actorId ||
        row.agentId !== input.agentId
      ) {
        throw new GatewayPersistenceError(
          'forbidden',
          'Node invocation expiration ownership denied',
        );
      }
      await transaction
        .update(gatewayNodeInvocations)
        .set({ status: 'expired', completedAt: now })
        .where(
          and(
            eq(gatewayNodeInvocations.requestId, input.requestId),
            eq(gatewayNodeInvocations.operationId, input.operationId),
            eq(gatewayNodeInvocations.status, 'pending'),
          ),
        );
    });
  }

  /**
   * 只允许 Operation 的真实 Actor/Personal Agent 调用其自有 Node。
   * 调用方不能补传主体字段；归属必须从 PostgreSQL 的 Operation 与 Pairing 事实中同事务解析。
   */
  async enqueue(raw: unknown): Promise<GatewayNodeInvocationRequest> {
    const request = gatewayNodeInvocationRequestSchema.parse(raw);
    return this.database.transaction(async (transaction) => {
      const [ownership] = await transaction
        .select({
          nodeUserId: gatewayNodePairings.userId,
          nodeAgentId: gatewayNodePairings.agentId,
          nodeStatus: gatewayNodePairings.status,
          nodeRevokedAt: gatewayNodePairings.revokedAt,
          approvedCapabilities: gatewayNodePairings.approvedCapabilities,
          operationActorUserId: agentOperations.actorUserId,
          operationAgentId: agentOperations.agentId,
        })
        .from(gatewayNodePairings)
        .innerJoin(agentOperations, eq(agentOperations.id, request.operationId))
        .where(eq(gatewayNodePairings.nodeId, request.nodeId))
        .limit(1)
        .for('update', { of: gatewayNodePairings });

      if (
        !ownership ||
        ownership.nodeStatus !== 'active' ||
        ownership.nodeRevokedAt !== null ||
        ownership.operationActorUserId !== ownership.nodeUserId ||
        ownership.operationAgentId !== ownership.nodeAgentId ||
        !ownership.approvedCapabilities.capabilities.some(
          (capability) => capability.name === request.capability,
        )
      ) {
        throw new GatewayPersistenceError(
          'forbidden',
          'Node invocation ownership or capability denied',
        );
      }

      await transaction.insert(gatewayNodeInvocations).values({
        requestId: request.requestId,
        operationId: request.operationId,
        nodeId: request.nodeId,
        capability: request.capability,
        parameters: request.parameters,
        nonce: request.nonce,
        status: 'pending',
        issuedAt: new Date(request.issuedAt),
        expiresAt: new Date(request.expiresAt),
      });
      return request;
    });
  }

  async poll(
    nodeId: string,
    now: Date = new Date(),
  ): Promise<readonly GatewayNodeInvocationRequest[]> {
    const pairing = await this.getActive(nodeId);
    if (!pairing)
      throw new GatewayPersistenceError('forbidden', 'Node revoked');
    await this.database
      .update(gatewayNodeInvocations)
      .set({ status: 'expired', completedAt: now })
      .where(
        and(
          eq(gatewayNodeInvocations.nodeId, nodeId),
          eq(gatewayNodeInvocations.status, 'pending'),
          lte(gatewayNodeInvocations.expiresAt, now),
        ),
      );
    const rows = await this.database
      .select()
      .from(gatewayNodeInvocations)
      .where(
        and(
          eq(gatewayNodeInvocations.nodeId, nodeId),
          eq(gatewayNodeInvocations.status, 'pending'),
          gt(gatewayNodeInvocations.expiresAt, now),
        ),
      )
      .orderBy(asc(gatewayNodeInvocations.issuedAt))
      .limit(20);
    return rows.map(projectInvocation);
  }

  async settle(raw: unknown): Promise<GatewayNodeInvocationResult> {
    const result = gatewayNodeInvocationResultSchema.parse(raw);
    const [updated] = await this.database
      .update(gatewayNodeInvocations)
      .set({
        status: result.status,
        result,
        completedAt: new Date(result.completedAt),
      })
      .where(
        and(
          eq(gatewayNodeInvocations.requestId, result.requestId),
          eq(gatewayNodeInvocations.nodeId, result.nodeId),
          eq(gatewayNodeInvocations.status, 'pending'),
        ),
      )
      .returning({ requestId: gatewayNodeInvocations.requestId });
    if (!updated) {
      throw new GatewayPersistenceError(
        'invalid_event_sequence',
        'Node result is replayed or unknown',
      );
    }
    return result;
  }

  async revoke(nodeId: string, now: Date = new Date()): Promise<void> {
    await this.database
      .update(gatewayNodePairings)
      .set({ status: 'revoked', revokedAt: now })
      .where(eq(gatewayNodePairings.nodeId, nodeId));
  }
}
