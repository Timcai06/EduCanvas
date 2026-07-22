import { and, asc, eq, gt, lte } from 'drizzle-orm';
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
    return rows.map((row) =>
      gatewayNodeInvocationRequestSchema.parse({
        requestId: row.requestId,
        operationId: row.operationId,
        nodeId: row.nodeId,
        capability: row.capability,
        parameters: row.parameters,
        nonce: row.nonce,
        issuedAt: row.issuedAt.toISOString(),
        expiresAt: row.expiresAt.toISOString(),
      }),
    );
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
