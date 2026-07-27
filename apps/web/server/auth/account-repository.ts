import 'server-only';

import {
  DrizzleWebAccountRepository,
  WebCredentialChangedError,
  WebUsernameTakenError,
  type WebUserProfileSnapshot,
} from '@educanvas/db';
import {
  consumeDummyPasswordVerification,
  hashPassword,
  verifyPassword,
} from './password';

/** Web 账号应用错误；HTTP 层只能映射稳定 code，不得透传内部异常。 */
export class AccountError extends Error {
  constructor(
    readonly code:
      | 'invalid_username'
      | 'invalid_nickname'
      | 'username_taken'
      | 'invalid_credentials'
      | 'invalid_current_password'
      | 'not_registered',
  ) {
    super(code);
    this.name = 'AccountError';
  }
}

export type WebUserProfile = WebUserProfileSnapshot;

const USERNAME = /^[A-Za-z0-9][A-Za-z0-9_-]{2,31}$/;

/** 将用户输入规范为数据库唯一键使用的小写用户名。 */
export function normalizeUsername(username: string): string {
  const normalized = username.trim().toLowerCase();
  if (!USERNAME.test(normalized)) throw new AccountError('invalid_username');
  return normalized;
}

/** 规范化显示昵称并拒绝空值、控制字符和超过 30 个字符的输入。 */
export function normalizeNickname(nickname: string): string {
  const normalized = nickname
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim();
  if ([...normalized].length < 1 || [...normalized].length > 30) {
    throw new AccountError('invalid_nickname');
  }
  return normalized;
}

/** Web 账号应用服务；组合密码策略与数据库事务，不负责写 Cookie。 */
export class WebAccountRepository {
  constructor(
    private readonly accountRepository = new DrizzleWebAccountRepository(),
  ) {}

  /**
   * 公共注册的原子边界；账号四张表与首个 session 必须在同一事务提交。
   * 原始 session token 只能由调用方保留到 Cookie 写入阶段。
   */
  async registerAndCreateSession(input: {
    username: string;
    nickname: string;
    password: string;
    newSession: { tokenHash: string; expiresAt: Date };
    now?: Date;
  }): Promise<WebUserProfile> {
    const username = normalizeUsername(input.username);
    const nickname = normalizeNickname(input.nickname);
    const passwordMaterial = await hashPassword(input.password);
    try {
      return await this.accountRepository.createRegisteredAccount({
        usernameNormalized: username,
        nickname,
        passwordMaterial,
        newSession: input.newSession,
        now: input.now,
      });
    } catch (error) {
      if (error instanceof WebUsernameTakenError) {
        throw new AccountError('username_taken');
      }
      throw error;
    }
  }

  async authenticate(input: {
    username: string;
    password: string;
  }): Promise<WebUserProfile> {
    const username = normalizeUsername(input.username);
    const row = await this.accountRepository.findByUsername(username);
    if (!row) {
      await consumeDummyPasswordVerification(input.password);
      throw new AccountError('invalid_credentials');
    }
    const valid = await verifyPassword({
      password: input.password,
      passwordHash: row.passwordHash,
      passwordSalt: row.passwordSalt,
      passwordParams: row.passwordParams,
    });
    if (!valid) throw new AccountError('invalid_credentials');
    return row;
  }

  async getProfile(userId: string): Promise<WebUserProfile | null> {
    return this.accountRepository.getProfile(userId);
  }

  async updateProfile(input: {
    userId: string;
    nickname: string;
    now?: Date;
  }): Promise<WebUserProfile> {
    const profile = await this.accountRepository.updateProfile({
      userId: input.userId,
      nickname: normalizeNickname(input.nickname),
      now: input.now,
    });
    if (!profile) throw new AccountError('not_registered');
    return profile;
  }

  async updateAvatar(input: {
    userId: string;
    objectKey: string;
    mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
    now?: Date;
  }): Promise<void> {
    const updated = await this.accountRepository.updateAvatar(input);
    if (!updated) throw new AccountError('not_registered');
  }

  /**
   * Web 改密的原子高层边界；调用方负责生成原始 token，
   * 本方法只接收其 hash 与过期时间，并在验证旧密码后统一轮换凭据和 session。
   */
  async changePasswordAndRotateSession(input: {
    userId: string;
    currentPassword: string;
    newPassword: string;
    newSession: { tokenHash: string; expiresAt: Date };
    now?: Date;
  }): Promise<void> {
    const credentials = await this.accountRepository.findCredentialsByUserId({
      userId: input.userId,
    });
    if (!credentials) throw new AccountError('not_registered');
    const valid = await verifyPassword({
      password: input.currentPassword,
      ...credentials,
    });
    if (!valid) throw new AccountError('invalid_current_password');
    try {
      await this.accountRepository.updatePasswordAndRotateSession({
        userId: input.userId,
        expectedCredential: {
          passwordHash: credentials.passwordHash,
          passwordSalt: credentials.passwordSalt,
        },
        passwordMaterial: await hashPassword(input.newPassword),
        newSession: input.newSession,
        now: input.now,
      });
    } catch (error) {
      if (error instanceof WebCredentialChangedError) {
        throw new AccountError('invalid_current_password');
      }
      throw error;
    }
  }

  async getAvatar(userId: string): Promise<{
    objectKey: string;
    mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  } | null> {
    return this.accountRepository.getAvatar(userId);
  }
}
