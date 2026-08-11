import { and, eq, gt, isNull } from 'drizzle-orm';
import { getDb } from './client';
import { platformUsers, webSessions } from './schema';

type Database = ReturnType<typeof getDb>;

/** Web session 持久化边界；只接收 token hash，绝不持有或返回浏览器原始 token。 */
export class DrizzleWebSessionRepository {
  constructor(private readonly providedDatabase?: Database) {}

  private get database(): Database {
    return this.providedDatabase ?? getDb();
  }

  async create(input: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    now?: Date;
  }): Promise<void> {
    const now = input.now ?? new Date();
    await this.database.insert(webSessions).values({
      userId: input.userId,
      tokenHash: input.tokenHash,
      createdAt: now,
      lastSeenAt: now,
      expiresAt: input.expiresAt,
    });
  }

  async findActiveRegisteredUserIdByTokenHash(input: {
    tokenHash: string;
    now?: Date;
  }): Promise<string | null> {
    const [session] = await this.database
      .select({ userId: webSessions.userId })
      .from(webSessions)
      .innerJoin(platformUsers, eq(platformUsers.id, webSessions.userId))
      .where(
        and(
          eq(webSessions.tokenHash, input.tokenHash),
          gt(webSessions.expiresAt, input.now ?? new Date()),
          isNull(webSessions.revokedAt),
          eq(platformUsers.kind, 'registered'),
          eq(platformUsers.status, 'active'),
        ),
      )
      .limit(1);
    return session?.userId ?? null;
  }

  async revokeByTokenHash(input: {
    tokenHash: string;
    now?: Date;
  }): Promise<void> {
    await this.database
      .update(webSessions)
      .set({ revokedAt: input.now ?? new Date() })
      .where(
        and(
          eq(webSessions.tokenHash, input.tokenHash),
          isNull(webSessions.revokedAt),
        ),
      );
  }

  /**
   * 原子消费一次性 credential：只有尚未撤销且未过期的 hash 能把 revokedAt 从 null
   * 改为当前时间。随后再次确认主体仍是 active registered user；主体失效时凭据也已
   * 被消费，按失败关闭处理。
   */
  async consumeActiveRegisteredUserIdByTokenHash(input: {
    tokenHash: string;
    now?: Date;
  }): Promise<string | null> {
    const now = input.now ?? new Date();
    const [consumed] = await this.database
      .update(webSessions)
      .set({ revokedAt: now })
      .where(
        and(
          eq(webSessions.tokenHash, input.tokenHash),
          gt(webSessions.expiresAt, now),
          isNull(webSessions.revokedAt),
        ),
      )
      .returning({ userId: webSessions.userId });
    if (!consumed) return null;
    const [user] = await this.database
      .select({ userId: platformUsers.id })
      .from(platformUsers)
      .where(
        and(
          eq(platformUsers.id, consumed.userId),
          eq(platformUsers.kind, 'registered'),
          eq(platformUsers.status, 'active'),
        ),
      )
      .limit(1);
    return user?.userId ?? null;
  }
}
