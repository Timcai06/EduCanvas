import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 跨客户端交接落点的信任边界守卫。/open 会依据 URL 参数切换当前笔记本，
 * 必须始终把写游标 gate 在服务端所有权校验之后——否则一个 URL 参数就能让
 * 浏览器串用他人对话。此测试锁定这条不变量，防止未来重构删掉校验。
 */
const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'route.ts'),
  'utf8',
);

describe('open handoff route', () => {
  it('validates conversation ownership before writing the active cursor', () => {
    /* 必须先按当前身份 getOwned 校验，且只有 owned 才写 cookie */
    expect(source).toContain('getOwned');
    expect(source).toContain('trustedSubjectId: identity.studentId');
    expect(source).toMatch(/if\s*\(owned\)\s*await writeActiveConversationCookie/);
  });

  it('rejects malformed conversation ids before any lookup', () => {
    expect(source).toContain('UUID_PATTERN.test(conversationId)');
  });

  it('never trusts the raw parameter as a conversation cursor', () => {
    /* 绝不直接把 searchParams 的值写进 cookie（必须经 owned.id） */
    expect(source).toContain('writeActiveConversationCookie(owned.id)');
    expect(source).not.toContain('writeActiveConversationCookie(conversationId)');
  });
});
