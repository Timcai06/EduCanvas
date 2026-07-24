import { randomUUID } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { getDb } from './client';
import {
  personalAgents,
  platformUsers,
  webSessions,
  webUserCredentials,
  webUserProfiles,
} from './schema';

type Database = ReturnType<typeof getDb>;

/** 数据库层可持久化的派生密码材料；不得包含明文密码。 */
export interface WebPasswordMaterial {
  passwordHash: string;
  passwordSalt: string;
  passwordParams: unknown;
}

/** 浏览器可见的最小账号资料投影，不暴露对象 key 或凭据材料。 */
export interface WebUserProfileSnapshot {
  userId: string;
  username: string;
  nickname: string;
  avatarAvailable: boolean;
}

/** 仅供认证应用层使用的凭据投影，不得序列化到 HTTP 响应。 */
export interface WebUserCredentialSnapshot extends WebUserProfileSnapshot {
  passwordHash: string;
  passwordSalt: string;
  passwordParams: unknown;
}

/** 目标用户名唯一约束冲突；路由应稳定映射为 409。 */
export class WebUsernameTakenError extends Error {
  constructor() {
    super('username_taken');
    this.name = 'WebUsernameTakenError';
  }
}

/** 已验证凭据在提交前被其他请求替换；调用方不得继续撤销或创建 session。 */
export class WebCredentialChangedError extends Error {
  constructor() {
    super('credential_changed');
    this.name = 'WebCredentialChangedError';
  }
}

function isUsernameUniqueViolation(error: unknown): boolean {
  let candidate: unknown = error;
  for (let depth = 0; depth < 3; depth += 1) {
    if (typeof candidate !== 'object' || candidate === null) return false;
    const databaseError = candidate as {
      code?: string;
      constraint_name?: string;
      cause?: unknown;
    };
    if (
      databaseError.code === '23505' &&
      databaseError.constraint_name === 'web_user_credentials_username_unique'
    ) {
      return true;
    }
    candidate = databaseError.cause;
  }
  return false;
}

function toProfile(row: {
  userId: string;
  usernameNormalized: string;
  nickname: string;
  avatarObjectKey: string | null;
}): WebUserProfileSnapshot {
  return {
    userId: row.userId,
    username: row.usernameNormalized,
    nickname: row.nickname,
    avatarAvailable: row.avatarObjectKey !== null,
  };
}

/** Web 账号 PostgreSQL 适配器；调用方不得绕过其事务与所有权边界。 */
export class DrizzleWebAccountRepository {
  constructor(private readonly providedDatabase?: Database) {}

  private get database(): Database {
    return this.providedDatabase ?? getDb();
  }

  async findByUsername(
    usernameNormalized: string,
  ): Promise<WebUserCredentialSnapshot | null> {
    const [row] = await this.database
      .select({
        userId: webUserCredentials.userId,
        usernameNormalized: webUserCredentials.usernameNormalized,
        passwordHash: webUserCredentials.passwordHash,
        passwordSalt: webUserCredentials.passwordSalt,
        passwordParams: webUserCredentials.passwordParams,
        nickname: webUserProfiles.nickname,
        avatarObjectKey: webUserProfiles.avatarObjectKey,
      })
      .from(webUserCredentials)
      .innerJoin(platformUsers, eq(platformUsers.id, webUserCredentials.userId))
      .innerJoin(
        webUserProfiles,
        eq(webUserProfiles.userId, webUserCredentials.userId),
      )
      .where(
        and(
          eq(webUserCredentials.usernameNormalized, usernameNormalized),
          eq(platformUsers.status, 'active'),
        ),
      )
      .limit(1);
    return row ? { ...toProfile(row), ...row } : null;
  }

  async findCredentialsByUserId(input: { userId: string }): Promise<{
    passwordHash: string;
    passwordSalt: string;
    passwordParams: unknown;
  } | null> {
    const [row] = await this.database
      .select({
        passwordHash: webUserCredentials.passwordHash,
        passwordSalt: webUserCredentials.passwordSalt,
        passwordParams: webUserCredentials.passwordParams,
      })
      .from(webUserCredentials)
      .innerJoin(platformUsers, eq(platformUsers.id, webUserCredentials.userId))
      .where(
        and(
          eq(webUserCredentials.userId, input.userId),
          eq(platformUsers.kind, 'registered'),
          eq(platformUsers.status, 'active'),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async createRegisteredAccount(input: {
    usernameNormalized: string;
    nickname: string;
    passwordMaterial: WebPasswordMaterial;
    newSession?: { tokenHash: string; expiresAt: Date };
    now?: Date;
  }): Promise<WebUserProfileSnapshot> {
    const now = input.now ?? new Date();
    const userId = `user:${randomUUID()}`;
    // Account creation spans four ownership tables and must commit atomically; partial rows would orphan auth state.
    try {
      await this.database.transaction(async (transaction) => {
        await transaction.insert(platformUsers).values({
          id: userId,
          kind: 'registered',
          createdAt: now,
          updatedAt: now,
        });
        await transaction.insert(personalAgents).values({
          userId,
          createdAt: now,
          updatedAt: now,
        });
        await transaction.insert(webUserCredentials).values({
          userId,
          usernameNormalized: input.usernameNormalized,
          passwordHash: input.passwordMaterial.passwordHash,
          passwordSalt: input.passwordMaterial.passwordSalt,
          passwordParams: input.passwordMaterial.passwordParams,
          createdAt: now,
          updatedAt: now,
        });
        await transaction.insert(webUserProfiles).values({
          userId,
          nickname: input.nickname,
          createdAt: now,
          updatedAt: now,
        });
        if (input.newSession) {
          await transaction.insert(webSessions).values({
            userId,
            tokenHash: input.newSession.tokenHash,
            createdAt: now,
            lastSeenAt: now,
            expiresAt: input.newSession.expiresAt,
          });
        }
      });
    } catch (error) {
      // 预查不能阻止并发注册竞态；只把目标用户名唯一键映射为稳定领域错误。
      if (isUsernameUniqueViolation(error)) throw new WebUsernameTakenError();
      throw error;
    }
    return {
      userId,
      username: input.usernameNormalized,
      nickname: input.nickname,
      avatarAvailable: false,
    };
  }

  async getProfile(userId: string): Promise<WebUserProfileSnapshot | null> {
    const [row] = await this.database
      .select({
        userId: webUserCredentials.userId,
        usernameNormalized: webUserCredentials.usernameNormalized,
        nickname: webUserProfiles.nickname,
        avatarObjectKey: webUserProfiles.avatarObjectKey,
      })
      .from(webUserCredentials)
      .innerJoin(
        webUserProfiles,
        eq(webUserProfiles.userId, webUserCredentials.userId),
      )
      .where(eq(webUserCredentials.userId, userId))
      .limit(1);
    return row ? toProfile(row) : null;
  }

  async updateProfile(input: {
    userId: string;
    nickname: string;
    now?: Date;
  }): Promise<WebUserProfileSnapshot | null> {
    await this.database
      .update(webUserProfiles)
      .set({ nickname: input.nickname, updatedAt: input.now ?? new Date() })
      .where(eq(webUserProfiles.userId, input.userId));
    return this.getProfile(input.userId);
  }

  async updateAvatar(input: {
    userId: string;
    objectKey: string;
    mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
    now?: Date;
  }): Promise<boolean> {
    const [updated] = await this.database
      .update(webUserProfiles)
      .set({
        avatarObjectKey: input.objectKey,
        avatarMimeType: input.mimeType,
        updatedAt: input.now ?? new Date(),
      })
      .where(eq(webUserProfiles.userId, input.userId))
      .returning({ userId: webUserProfiles.userId });
    return updated !== undefined;
  }

  /**
   * 密码轮换事务边界：新密码落库、旧 session 撤销与新 session 创建必须同成同败。
   * 调用方只传派生密码材料和 token hash；明文密码及原始 token 不得进入数据库层。
   */
  async updatePasswordAndRotateSession(input: {
    userId: string;
    expectedCredential: { passwordHash: string; passwordSalt: string };
    passwordMaterial: WebPasswordMaterial;
    newSession: { tokenHash: string; expiresAt: Date };
    now?: Date;
  }): Promise<void> {
    const now = input.now ?? new Date();
    await this.database.transaction(async (transaction) => {
      const [updatedCredential] = await transaction
        .update(webUserCredentials)
        .set({
          passwordHash: input.passwordMaterial.passwordHash,
          passwordSalt: input.passwordMaterial.passwordSalt,
          passwordParams: input.passwordMaterial.passwordParams,
          updatedAt: now,
        })
        .where(
          and(
            eq(webUserCredentials.userId, input.userId),
            eq(
              webUserCredentials.passwordHash,
              input.expectedCredential.passwordHash,
            ),
            eq(
              webUserCredentials.passwordSalt,
              input.expectedCredential.passwordSalt,
            ),
          ),
        )
        .returning({ userId: webUserCredentials.userId });
      if (!updatedCredential) throw new WebCredentialChangedError();
      await transaction
        .update(webSessions)
        .set({ revokedAt: now })
        .where(
          and(
            eq(webSessions.userId, input.userId),
            isNull(webSessions.revokedAt),
          ),
        );
      await transaction.insert(webSessions).values({
        userId: input.userId,
        tokenHash: input.newSession.tokenHash,
        createdAt: now,
        lastSeenAt: now,
        expiresAt: input.newSession.expiresAt,
      });
    });
  }

  async getAvatar(userId: string): Promise<{
    objectKey: string;
    mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  } | null> {
    const [row] = await this.database
      .select({
        objectKey: webUserProfiles.avatarObjectKey,
        mimeType: webUserProfiles.avatarMimeType,
      })
      .from(webUserProfiles)
      .where(eq(webUserProfiles.userId, userId))
      .limit(1);
    if (
      !row?.objectKey ||
      (row.mimeType !== 'image/png' &&
        row.mimeType !== 'image/jpeg' &&
        row.mimeType !== 'image/webp')
    ) {
      return null;
    }
    return { objectKey: row.objectKey, mimeType: row.mimeType };
  }
}
