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
}
