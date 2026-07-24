import 'server-only';

import {
  DrizzleWebAccountRepository,
  WebUsernameTakenError,
  type WebUserProfileSnapshot,
} from '@educanvas/db';
import { hashPassword, verifyPassword } from './password';

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

export function normalizeUsername(username: string): string {
  const normalized = username.trim().toLowerCase();
  if (!USERNAME.test(normalized)) throw new AccountError('invalid_username');
  return normalized;
}

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

export class WebAccountRepository {
  constructor(
    private readonly accountRepository = new DrizzleWebAccountRepository(),
  ) {}

  async register(input: {
    username: string;
    nickname: string;
    password: string;
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
    if (!row) throw new AccountError('invalid_credentials');
    const valid = await verifyPassword({
      password: input.password,
      passwordHash: row.passwordHash,
      passwordSalt: row.passwordSalt,
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
    await this.accountRepository.updateAvatar(input);
  }

  async changePassword(input: {
    userId: string;
    currentPassword: string;
    newPassword: string;
    now?: Date;
  }): Promise<void> {
    const credentials = await this.accountRepository.findCredentialsByUserId({
      userId: input.userId,
    });
    if (!credentials) throw new AccountError('not_registered');
    const valid = await verifyPassword({
      password: input.currentPassword,
      passwordHash: credentials.passwordHash,
      passwordSalt: credentials.passwordSalt,
    });
    if (!valid) throw new AccountError('invalid_current_password');
    await this.accountRepository.updatePassword({
      userId: input.userId,
      passwordMaterial: await hashPassword(input.newPassword),
      now: input.now,
    });
  }

  async getAvatar(userId: string): Promise<{
    objectKey: string;
    mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  } | null> {
    return this.accountRepository.getAvatar(userId);
  }
}
