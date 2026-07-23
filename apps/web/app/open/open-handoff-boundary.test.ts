import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 跨客户端交接落点的信任边界守卫。/open 只能消费 Gateway 签发的短期凭证，
 * 必须始终把写游标 gate 在服务端原子消费之后，不能再信任 URL Conversation ID。
 */
const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'route.ts'),
  'utf8',
);

describe('open handoff route', () => {
  it('consumes the credential for the current identity before writing the cursor', () => {
    expect(source).toContain('handoffs.consume');
    expect(source).toContain('trustedSubjectId: identity.studentId');
    expect(source).toMatch(
      /if\s*\(result\.status === 'consumed'\)[\s\S]*writeActiveConversationCookie\(result\.conversationId\)/,
    );
  });

  it('rejects malformed credentials before any database lookup', () => {
    expect(source).toContain('gatewayHandoffTokenSchema.safeParse(token)');
    expect(source).toMatch(/if\s*\(parsed\.success\)[\s\S]*handoffs\.consume/);
  });

  it('never persists the raw token or accepts a conversation query parameter', () => {
    expect(source).toContain("searchParams.get('token')");
    expect(source).not.toContain("searchParams.get('conversation')");
    expect(source).not.toContain('writeActiveConversationCookie(parsed.data)');
  });
});
