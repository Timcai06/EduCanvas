import type { DrizzleWebSessionRepository } from '@educanvas/db';
import {
  gatewayDesktopTokenExchangeRequestSchema,
  gatewayDesktopTokenGrantSchema,
  type GatewayDesktopTokenExchangeRequest,
  type GatewayDesktopTokenGrant,
} from '@educanvas/gateway-core';
import {
  createDesktopAuthorizationCode,
  createDesktopSessionToken,
  hashDesktopCredential,
  verifyDesktopAuthorizationCode,
  verifyDesktopPkce,
} from './authorization-code';

const DESKTOP_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1_000;

type DesktopSessionRepository = Pick<
  DrizzleWebSessionRepository,
  'create' | 'consumeActiveRegisteredUserIdByTokenHash'
>;

export class DesktopAuthError extends Error {
  override readonly name = 'DesktopAuthError';

  constructor(readonly code: 'invalid_grant' | 'server_not_configured') {
    super(code);
  }
}

export function createDesktopAuthService(options: {
  repository: DesktopSessionRepository;
  secret: string;
  now?: () => Date;
  randomBytes?: (size: number) => Buffer;
}) {
  const now = options.now ?? (() => new Date());

  return {
    async issueAuthorizationCode(input: {
      userId: string;
      codeChallenge: string;
      notebookId: string;
      conversationId: string;
    }): Promise<{ code: string; expiresAt: Date }> {
      let code: string;
      try {
        code = createDesktopAuthorizationCode(
          {
            codeChallenge: input.codeChallenge,
            notebookId: input.notebookId,
            conversationId: input.conversationId,
          },
          {
            secret: options.secret,
            now,
            ...(options.randomBytes
              ? { randomBytes: options.randomBytes }
              : {}),
          },
        );
      } catch {
        throw new DesktopAuthError('server_not_configured');
      }
      const verified = verifyDesktopAuthorizationCode(code, {
        secret: options.secret,
        now,
      });
      if (!verified) throw new DesktopAuthError('server_not_configured');
      await options.repository.create({
        userId: input.userId,
        tokenHash: hashDesktopCredential(code),
        expiresAt: verified.expiresAt,
        now: now(),
      });
      return { code, expiresAt: verified.expiresAt };
    },

    async exchange(
      raw: GatewayDesktopTokenExchangeRequest,
    ): Promise<GatewayDesktopTokenGrant> {
      const request = gatewayDesktopTokenExchangeRequestSchema.parse(raw);
      const verified = verifyDesktopAuthorizationCode(request.code, {
        secret: options.secret,
        now,
      });
      if (
        !verified ||
        !verifyDesktopPkce(verified.codeChallenge, request.code_verifier)
      ) {
        throw new DesktopAuthError('invalid_grant');
      }
      const current = now();
      const userId =
        await options.repository.consumeActiveRegisteredUserIdByTokenHash({
          tokenHash: hashDesktopCredential(request.code),
          now: current,
        });
      if (!userId) throw new DesktopAuthError('invalid_grant');

      const token = createDesktopSessionToken(options.randomBytes);
      const expiresAt = new Date(current.getTime() + DESKTOP_SESSION_TTL_MS);
      await options.repository.create({
        userId,
        tokenHash: hashDesktopCredential(token),
        expiresAt,
        now: current,
      });
      return gatewayDesktopTokenGrantSchema.parse({
        access_token: token,
        token_type: 'Bearer',
        expires_at: expiresAt.toISOString(),
        user_id: userId,
        notebook_id: verified.notebookId,
        conversation_id: verified.conversationId,
      });
    },
  };
}
