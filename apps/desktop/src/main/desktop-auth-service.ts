import { revokeGatewayDesktopSession } from '@educanvas/gateway-client';
import {
  gatewayDesktopClientId,
  gatewayDesktopRedirectUri,
  gatewayDesktopTokenGrantSchema,
} from '@educanvas/gateway-core';
import type { StoredDesktopSession } from './desktop-session-store';
import type { DesktopAuthStatus } from '../shared/desktop-auth';
import {
  buildDesktopAuthorizationUrl,
  createDesktopPkceRequest,
  parseDesktopAuthCallback,
} from './native-auth';

interface DesktopSessionStorePort {
  load(): Promise<StoredDesktopSession | null>;
  save(session: StoredDesktopSession): Promise<void>;
  clear(): Promise<void>;
}

const PENDING_AUTH_TTL_MS = 10 * 60_000;
const DEFAULT_REVOKE_TIMEOUT_MS = 5_000;

/**
 * Main-process-only native authorization coordinator. RFC 8252 requires the system
 * browser; Electron's supported API is shell.openExternal:
 * https://www.electronjs.org/docs/latest/api/shell
 */
export function createDesktopAuthCoordinator(options: {
  webBaseUrl: string;
  gatewayBaseUrl: string;
  sessionStore: DesktopSessionStorePort;
  openExternal(url: string): Promise<void>;
  onStatus?(status: DesktopAuthStatus): void;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  randomBytes?: (size: number) => Buffer;
  revokeSession?(session: StoredDesktopSession): Promise<void>;
  revokeTimeoutMs?: number;
}) {
  const now = options.now ?? (() => new Date());
  const fetchImpl = options.fetchImpl ?? fetch;
  let cachedSession: StoredDesktopSession | null | undefined;
  let pending: {
    state: string;
    codeVerifier: string;
    createdAtMs: number;
  } | null = null;
  let status: DesktopAuthStatus = { state: 'signed_out' };
  let sessionGeneration = 0;

  const publish = (next: DesktopAuthStatus): DesktopAuthStatus => {
    status = next;
    options.onStatus?.(next);
    return next;
  };

  const loadSession = async (): Promise<StoredDesktopSession | null> => {
    if (cachedSession === undefined) {
      cachedSession = await options.sessionStore.load();
      publish(cachedSession ? { state: 'signed_in' } : { state: 'signed_out' });
    }
    return cachedSession;
  };

  const clearSession = async (): Promise<void> => {
    cachedSession = null;
    pending = null;
    await options.sessionStore.clear();
  };

  return {
    async getStatus(): Promise<DesktopAuthStatus> {
      await loadSession();
      return status;
    },

    getSession: loadSession,

    async signIn(): Promise<DesktopAuthStatus> {
      const pkce = createDesktopPkceRequest(options.randomBytes);
      pending = {
        state: pkce.state,
        codeVerifier: pkce.codeVerifier,
        createdAtMs: now().getTime(),
      };
      const url = buildDesktopAuthorizationUrl(options.webBaseUrl, pkce);
      publish({ state: 'authorizing' });
      try {
        await options.openExternal(url.toString());
        return status;
      } catch {
        pending = null;
        return publish({
          state: 'error',
          message: '无法打开系统浏览器，请稍后重试。',
        });
      }
    },

    async handleDeepLink(raw: string): Promise<DesktopAuthStatus> {
      const current = pending;
      if (
        !current ||
        now().getTime() - current.createdAtMs > PENDING_AUTH_TTL_MS
      ) {
        pending = null;
        return publish({
          state: 'error',
          message: '登录请求已失效，请重新发起。',
        });
      }
      let code: string;
      try {
        code = parseDesktopAuthCallback(raw, current.state).code;
      } catch {
        pending = null;
        return publish({
          state: 'error',
          message: '登录回调校验失败，请重新发起。',
        });
      }
      // Callback credential is single-use from this point even when the network fails.
      pending = null;
      const exchangeGeneration = sessionGeneration;
      try {
        const response = await fetchImpl(
          new URL('/api/v1/desktop-auth/token', options.webBaseUrl),
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              grant_type: 'authorization_code',
              client_id: gatewayDesktopClientId,
              redirect_uri: gatewayDesktopRedirectUri,
              code,
              code_verifier: current.codeVerifier,
            }),
            signal: AbortSignal.timeout(15_000),
          },
        );
        if (!response.ok) {
          response.body?.cancel().catch(() => undefined);
          throw new Error('exchange_rejected');
        }
        const grant = gatewayDesktopTokenGrantSchema.parse(
          await response.json(),
        );
        const session: StoredDesktopSession = {
          token: grant.access_token,
          expiresAt: grant.expires_at,
          webBaseUrl: options.webBaseUrl,
          gatewayBaseUrl: options.gatewayBaseUrl,
          userId: grant.user_id,
          notebookId: grant.notebook_id,
          conversationId: grant.conversation_id,
        };
        if (exchangeGeneration !== sessionGeneration) return status;
        await options.sessionStore.save(session);
        if (exchangeGeneration !== sessionGeneration) {
          await options.sessionStore.clear();
          return status;
        }
        cachedSession = session;
        return publish({ state: 'signed_in' });
      } catch {
        return publish({
          state: 'error',
          message: '登录未完成，请检查网络后重试。',
        });
      }
    },

    async invalidateSession(): Promise<DesktopAuthStatus> {
      sessionGeneration += 1;
      await clearSession();
      return publish({ state: 'signed_out' });
    },

    async signOut(): Promise<DesktopAuthStatus> {
      const session = await loadSession();
      sessionGeneration += 1;
      await clearSession();
      publish({ state: 'signed_out' });
      try {
        if (session) {
          const revoke = options.revokeSession
            ? options.revokeSession(session)
            : revokeGatewayDesktopSession(
                session.gatewayBaseUrl,
                session.token,
              );
          await Promise.race([
            revoke,
            new Promise<void>((resolve) =>
              setTimeout(
                resolve,
                options.revokeTimeoutMs ?? DEFAULT_REVOKE_TIMEOUT_MS,
              ),
            ),
          ]);
        }
      } catch {
        // Local credential removal is still mandatory when the network is unavailable.
      }
      return status;
    },
  };
}

export type DesktopAuthCoordinator = ReturnType<
  typeof createDesktopAuthCoordinator
>;
