import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  loginInputSchema,
  passwordChangeInputSchema,
  profileUpdateInputSchema,
  registerInputSchema,
} from './input-policy';

describe('认证 JSON 字段边界', () => {
  it('接受边界内输入并拒绝额外字段', () => {
    expect(
      loginInputSchema.safeParse({
        username: 'student',
        password: 'secret12',
      }).success,
    ).toBe(true);
    expect(
      loginInputSchema.safeParse({
        username: 'student',
        password: 'secret12',
        role: 'admin',
      }).success,
    ).toBe(false);
  });

  it('在账号仓储前拒绝超长用户名与昵称', () => {
    expect(
      registerInputSchema.safeParse({
        username: 'u'.repeat(33),
        nickname: '昵称',
        password: 'secret',
      }).success,
    ).toBe(false);
    expect(
      registerInputSchema.safeParse({
        username: 'student',
        nickname: '昵'.repeat(31),
        password: 'secret',
      }).success,
    ).toBe(false);
  });

  it('按 Unicode 字符将新旧密码统一限制为 8 至 128 位', () => {
    const maxPassword = '🔐'.repeat(128);
    expect(
      passwordChangeInputSchema.safeParse({
        currentPassword: maxPassword,
        newPassword: maxPassword,
      }).success,
    ).toBe(true);
    expect(
      passwordChangeInputSchema.safeParse({
        currentPassword: `${maxPassword}x`,
        newPassword: 'new-secret',
      }).success,
    ).toBe(false);
    expect(
      passwordChangeInputSchema.safeParse({
        currentPassword: '1234567',
        newPassword: 'new-secret',
      }).success,
    ).toBe(false);
  });
});

describe('profileUpdateInputSchema', () => {
  it('拒绝超长昵称和额外字段', () => {
    expect(
      profileUpdateInputSchema.safeParse({ nickname: '学'.repeat(31) }).success,
    ).toBe(false);
    expect(
      profileUpdateInputSchema.safeParse({
        nickname: '同学',
        userId: 'user:other',
      }).success,
    ).toBe(false);
  });
});
