import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createDesktopAuthService } from './desktop-auth-service';

const now = new Date('2026-08-11T08:00:00.000Z');
const verifier = 'v'.repeat(43);
const challenge = createHash('sha256')
  .update(verifier, 'utf8')
  .digest('base64url');

class MemorySessions {
  readonly active = new Map<string, { userId: string; expiresAt: Date }>();
  readonly created: Array<{
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  }> = [];

  async create(input: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<void> {
    this.created.push(input);
    this.active.set(input.tokenHash, {
      userId: input.userId,
      expiresAt: input.expiresAt,
    });
  }

  async consumeActiveRegisteredUserIdByTokenHash(input: {
    tokenHash: string;
    now?: Date;
  }): Promise<string | null> {
    const record = this.active.get(input.tokenHash);
    if (!record || record.expiresAt <= (input.now ?? new Date())) return null;
    this.active.delete(input.tokenHash);
    return record.userId;
  }
}

function service(repo = new MemorySessions()) {
  return {
    repo,
    auth: createDesktopAuthService({
      repository: repo,
      secret: 's'.repeat(32),
      now: () => now,
      randomBytes: (size) => Buffer.alloc(size, repo.created.length + 1),
    }),
  };
}

describe('DesktopAuthService', () => {
  it('stores only the authorization-code hash and a two-minute lifetime', async () => {
    const { repo, auth } = service();
    const issued = await auth.issueAuthorizationCode({
      userId: 'user:one',
      codeChallenge: challenge,
      notebookId: 'notebook:one',
      conversationId: 'conversation:one',
    });
    expect(issued.code).toMatch(/^eca1\./);
    expect(repo.created).toHaveLength(1);
    expect(repo.created[0]).toMatchObject({ userId: 'user:one' });
    expect(repo.created[0]!.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(repo.created[0]!.tokenHash).not.toContain(issued.code);
    expect(repo.created[0]!.expiresAt.toISOString()).toBe(
      '2026-08-11T08:02:00.000Z',
    );
  });

  it('does not consume the code when PKCE verification fails', async () => {
    const { repo, auth } = service();
    const issued = await auth.issueAuthorizationCode({
      userId: 'user:one',
      codeChallenge: challenge,
      notebookId: 'notebook:one',
      conversationId: 'conversation:one',
    });
    await expect(
      auth.exchange({
        grant_type: 'authorization_code',
        client_id: 'educanvas-desktop',
        redirect_uri: 'educanvas://auth/callback',
        code: issued.code,
        code_verifier: 'x'.repeat(43),
      }),
    ).rejects.toMatchObject({
      code: 'invalid_grant',
    });
    expect(repo.active.size).toBe(1);
  });

  it('atomically exchanges once and creates a 30-day desktop session', async () => {
    const { repo, auth } = service();
    const issued = await auth.issueAuthorizationCode({
      userId: 'user:one',
      codeChallenge: challenge,
      notebookId: 'notebook:one',
      conversationId: 'conversation:one',
    });
    const request = {
      grant_type: 'authorization_code' as const,
      client_id: 'educanvas-desktop' as const,
      redirect_uri: 'educanvas://auth/callback' as const,
      code: issued.code,
      code_verifier: verifier,
    };
    const grant = await auth.exchange(request);
    expect(grant).toMatchObject({
      access_token: expect.stringMatching(/^ecs1_/),
      token_type: 'Bearer',
      user_id: 'user:one',
      notebook_id: 'notebook:one',
      conversation_id: 'conversation:one',
      expires_at: '2026-09-10T08:00:00.000Z',
    });
    expect(repo.created).toHaveLength(2);
    expect(repo.created[1]!.tokenHash).not.toContain(grant.access_token);
    await expect(auth.exchange(request)).rejects.toMatchObject({
      code: 'invalid_grant',
    });
  });
});
