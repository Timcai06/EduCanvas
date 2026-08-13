import 'server-only';

import { createHash } from 'node:crypto';
import { DrizzleWebSessionRepository } from '@educanvas/db';
import { gatewayDesktopSessionTokenSchema } from '@educanvas/gateway-core';
import { readRegisteredSessionIdentity } from './session';

export type AuthenticatedRequestIdentity = {
  userId: string;
  source: 'web' | 'desktop';
};

/**
 * 请求级可信主体解析。显式 Authorization 永不回退 Cookie，避免攻击者用非法 bearer
 * 触发浏览器 session 的混淆认证；无 Authorization 时保留 Web session / local 部署身份。
 */
export async function readAuthenticatedRequestIdentity(
  request: Request,
): Promise<AuthenticatedRequestIdentity | null> {
  const authorization = request.headers.get('authorization');
  if (authorization !== null) {
    if (!authorization.startsWith('Bearer ')) return null;
    const parsed = gatewayDesktopSessionTokenSchema.safeParse(
      authorization.slice('Bearer '.length),
    );
    if (!parsed.success) return null;
    const userId =
      await new DrizzleWebSessionRepository().findActiveRegisteredUserIdByTokenHash(
        {
          tokenHash: createHash('sha256')
            .update(parsed.data, 'utf8')
            .digest('hex'),
        },
      );
    return userId ? { userId, source: 'desktop' } : null;
  }
  if (process.env.EDUCANVAS_DEPLOYMENT_ENV?.trim() === 'local') {
    return {
      userId: process.env.EDUCANVAS_LOCAL_USER_ID?.trim() || 'local:owner',
      source: 'web',
    };
  }
  const web = await readRegisteredSessionIdentity();
  return web ? { ...web, source: 'web' } : null;
}
