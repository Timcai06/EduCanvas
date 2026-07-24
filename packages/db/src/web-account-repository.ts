import { randomUUID } from 'node:crypto';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { getDb } from './client';
import {
  personalAgents,
  platformUsers,
  webSessions,
  webUserCredentials,
  webUserProfiles,
} from './schema';

type Database = ReturnType<typeof getDb>;

export interface WebPasswordMaterial {
  passwordHash: string;
  passwordSalt: string;
  passwordParams: unknown;
}

export interface WebUserProfileSnapshot {
  userId: string;
  username: string;
  nickname: string;
  avatarAvailable: boolean;
}

export interface WebUserCredentialSnapshot extends WebUserProfileSnapshot {
  passwordHash: string;
  passwordSalt: string;
}

export class WebUsernameTakenError extends Error {
  constructor() {
    super('username_taken');
    this.name = 'WebUsernameTakenError';
  }
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

  async findCredentialsByUserId(input: {
    userId: string;
  }): Promise<{ passwordHash: string; passwordSalt: string } | null> {
    const [row] = await this.database
      .select({
        passwordHash: webUserCredentials.passwordHash,
        passwordSalt: webUserCredentials.passwordSalt,
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
    now?: Date;
  }): Promise<WebUserProfileSnapshot> {
    const existing = await this.findByUsername(input.usernameNormalized);
    if (existing) throw new WebUsernameTakenError();

    const now = input.now ?? new Date();
    const userId = `user:${randomUUID()}`;
    // Account creation spans four ownership tables and must commit atomically; partial rows would orphan auth state.
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
    });
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
  }): Promise<void> {
    await this.database
      .update(webUserProfiles)
      .set({
        avatarObjectKey: input.objectKey,
        avatarMimeType: input.mimeType,
        updatedAt: input.now ?? new Date(),
      })
      .where(eq(webUserProfiles.userId, input.userId));
  }

  async updatePassword(input: {
    userId: string;
    passwordMaterial: WebPasswordMaterial;
    now?: Date;
  }): Promise<void> {
    // The derived material replaces the old hash in one write; plaintext never reaches this layer.
    await this.database
      .update(webUserCredentials)
      .set({
        passwordHash: input.passwordMaterial.passwordHash,
        passwordSalt: input.passwordMaterial.passwordSalt,
        passwordParams: input.passwordMaterial.passwordParams,
        updatedAt: input.now ?? new Date(),
      })
      .where(eq(webUserCredentials.userId, input.userId));
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

  async revokeAllForUser(input: { userId: string; now?: Date }): Promise<void> {
    // Password changes invalidate every existing browser session before a fresh one is issued.
    await this.database
      .update(webSessions)
      .set({ revokedAt: input.now ?? new Date() })
      .where(
        and(
          eq(webSessions.userId, input.userId),
          isNull(webSessions.revokedAt),
        ),
      );
  }
}
