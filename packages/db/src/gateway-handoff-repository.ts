import { and, eq, gt, isNull } from 'drizzle-orm';
import { getDb } from './client';
import { GatewayPersistenceError } from './gateway-repository';
import { conversations, gatewayHandoffTokens } from './schema';

type Database = ReturnType<typeof getDb>;

/** 仅供可信服务端测试与审计区分拒绝原因；不得原样暴露给未认证调用方。 */
export type GatewayHandoffRejectionReason =
  'invalid' | 'expired' | 'replayed' | 'forbidden';

/** 原子消费结果；只有 `consumed` 分支允许调用方写客户端 Conversation 游标。 */
export type GatewayHandoffConsumeResult =
  | { status: 'consumed'; conversationId: string }
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
  }): Promise<{ expiresAt: string }> {
    const [owned] = await this.database
      .select({ id: conversations.id })
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

    await this.database.insert(gatewayHandoffTokens).values({
      tokenDigest: input.tokenDigest,
      userId: input.userId,
      conversationId: owned.id,
      issuedAt: input.issuedAt,
      expiresAt: input.expiresAt,
    });
    return { expiresAt: input.expiresAt.toISOString() };
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
      .returning({ conversationId: gatewayHandoffTokens.conversationId });
    if (consumed) {
      return { status: 'consumed', conversationId: consumed.conversationId };
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
