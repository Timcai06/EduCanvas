import { and, eq, gt, isNull } from 'drizzle-orm';
import { getDb } from './client';
import { GatewayPersistenceError } from './gateway-repository';
import {
  artifactVersions,
  artifacts,
  assetVersions,
  assets,
  conversationMessages,
  conversations,
  gatewayHandoffTokens,
} from './schema';
import type { GatewayHandoffTarget } from '@educanvas/gateway-core';

type Database = ReturnType<typeof getDb>;

/** 仅供可信服务端测试与审计区分拒绝原因；不得原样暴露给未认证调用方。 */
export type GatewayHandoffRejectionReason =
  'invalid' | 'expired' | 'replayed' | 'forbidden';

/** 原子消费结果；只有 `consumed` 分支允许调用方写客户端 Conversation 游标。 */
export type GatewayHandoffConsumeResult =
  | {
      status: 'consumed';
      conversationId: string;
      /** 精确资源目标（DP08）；null 表示仅切对话（DP07 语义）。 */
      target: GatewayHandoffTarget | null;
    }
  | { status: 'rejected'; reason: GatewayHandoffRejectionReason };

/**
 * 一次性 Web 交接的 PostgreSQL 适配器。签发必须来自已认证 Gateway 主体；消费必须
 * 带当前 Web 可信主体，并以单条条件 UPDATE 收敛并发重放，调用方不得自行绕过归属判断。
 */
export class DrizzleGatewayHandoffRepository {
  constructor(private readonly providedDatabase?: Database) {}

  private get database(): Database {
    return this.providedDatabase ?? getDb();
  }

  async issue(input: {
    tokenDigest: string;
    userId: string;
    conversationId: string;
    issuedAt: Date;
    expiresAt: Date;
    target?: GatewayHandoffTarget;
  }): Promise<{ expiresAt: string }> {
    const [owned] = await this.database
      .select({ id: conversations.id, spaceId: conversations.spaceId })
      .from(conversations)
      .where(
        and(
          eq(conversations.id, input.conversationId),
          eq(conversations.ownerSubjectId, input.userId),
          eq(conversations.status, 'active'),
        ),
      )
      .limit(1);
    if (!owned) {
      throw new GatewayPersistenceError(
        'forbidden',
        'Cannot hand off an inaccessible conversation',
      );
    }

    const target =
      input.target && input.target.kind !== 'conversation'
        ? await this.assertTargetOwned({
            target: input.target,
            userId: input.userId,
            spaceId: owned.spaceId,
            conversationId: owned.id,
          })
        : null;

    await this.database.insert(gatewayHandoffTokens).values({
      tokenDigest: input.tokenDigest,
      userId: input.userId,
      conversationId: owned.id,
      issuedAt: input.issuedAt,
      expiresAt: input.expiresAt,
      target,
    });
    return { expiresAt: input.expiresAt.toISOString() };
  }

  /**
   * 校验资源目标属于该用户与 Conversation 所在空间。归属失败一律抛
   * `forbidden`（与 conversation 检查一致），不向调用方区分具体原因。
   */
  private async assertTargetOwned(input: {
    target: GatewayHandoffTarget;
    userId: string;
    spaceId: string;
    conversationId: string;
  }): Promise<GatewayHandoffTarget> {
    const { target } = input;
    if (target.kind === 'message') {
      const [message] = await this.database
        .select({ id: conversationMessages.id })
        .from(conversationMessages)
        .where(
          and(
            eq(conversationMessages.id, target.messageId),
            eq(conversationMessages.conversationId, input.conversationId),
          ),
        )
        .limit(1);
      if (!message) {
        throw new GatewayPersistenceError(
          'forbidden',
          'Handoff target is not accessible',
        );
      }
      return target;
    }
    if (target.kind === 'artifact') {
      const [artifact] = await this.database
        .select({ id: artifacts.id })
        .from(artifacts)
        .where(
          and(
            eq(artifacts.id, target.artifactId),
            eq(artifacts.ownerSubjectId, input.userId),
            eq(artifacts.spaceId, input.spaceId),
          ),
        )
        .limit(1);
      if (!artifact) {
        throw new GatewayPersistenceError(
          'forbidden',
          'Handoff target is not accessible',
        );
      }
      if (target.versionId) {
        const [version] = await this.database
          .select({ id: artifactVersions.id })
          .from(artifactVersions)
          .where(
            and(
              eq(artifactVersions.id, target.versionId),
              eq(artifactVersions.artifactId, target.artifactId),
            ),
          )
          .limit(1);
        if (!version) {
          throw new GatewayPersistenceError(
            'forbidden',
            'Handoff target is not accessible',
          );
        }
      }
      return target;
    }
    // resource（source 或 artifact 两种 resourceKind 在此统一按空间归属校验）
    if (target.kind !== 'resource') {
      throw new GatewayPersistenceError(
        'forbidden',
        'Handoff target is not accessible',
      );
    }
    const [asset] = await this.database
      .select({ id: assets.id })
      .from(assets)
      .where(
        and(
          eq(assets.id, target.resourceId),
          eq(assets.ownerSubjectId, input.userId),
          eq(assets.spaceId, input.spaceId),
        ),
      )
      .limit(1);
    if (!asset) {
      throw new GatewayPersistenceError(
        'forbidden',
        'Handoff target is not accessible',
      );
    }
    if (target.versionId) {
      const [version] = await this.database
        .select({ id: assetVersions.id })
        .from(assetVersions)
        .where(
          and(
            eq(assetVersions.id, target.versionId),
            eq(assetVersions.assetId, target.resourceId),
          ),
        )
        .limit(1);
      if (!version) {
        throw new GatewayPersistenceError(
          'forbidden',
          'Handoff target is not accessible',
        );
      }
    }
    return target;
  }

  async consume(input: {
    tokenDigest: string;
    trustedSubjectId: string;
    now?: Date;
  }): Promise<GatewayHandoffConsumeResult> {
    const now = input.now ?? new Date();
    const [consumed] = await this.database
      .update(gatewayHandoffTokens)
      .set({ consumedAt: now })
      .where(
        and(
          eq(gatewayHandoffTokens.tokenDigest, input.tokenDigest),
          eq(gatewayHandoffTokens.userId, input.trustedSubjectId),
          isNull(gatewayHandoffTokens.consumedAt),
          gt(gatewayHandoffTokens.expiresAt, now),
        ),
      )
      .returning({
        conversationId: gatewayHandoffTokens.conversationId,
        target: gatewayHandoffTokens.target,
      });
    if (consumed) {
      return {
        status: 'consumed',
        conversationId: consumed.conversationId,
        target: consumed.target ?? null,
      };
    }

    const [record] = await this.database
      .select({
        userId: gatewayHandoffTokens.userId,
        expiresAt: gatewayHandoffTokens.expiresAt,
        consumedAt: gatewayHandoffTokens.consumedAt,
      })
      .from(gatewayHandoffTokens)
      .where(eq(gatewayHandoffTokens.tokenDigest, input.tokenDigest))
      .limit(1);
    if (!record) return { status: 'rejected', reason: 'invalid' };
    if (record.userId !== input.trustedSubjectId) {
      return { status: 'rejected', reason: 'forbidden' };
    }
    if (record.consumedAt) return { status: 'rejected', reason: 'replayed' };
    if (record.expiresAt <= now) {
      return { status: 'rejected', reason: 'expired' };
    }
    return { status: 'rejected', reason: 'invalid' };
  }
}
