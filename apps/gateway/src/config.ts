import {
  resolveGatewayTerminalReconciliationMode,
  type GatewayTerminalReconciliationMode,
} from '@educanvas/db';

export interface GatewayConfig {
  host: string;
  port: number;
  internalToken: string | null;
  bootstrapToken: string | null;
  sessionSecret: string | null;
  localOnboardingEnabled: boolean;
  localUserId: string;
  /** 实时语音 WebSocket 握手允许的浏览器 Origin（严格白名单，已规范化）。 */
  wsAllowedOrigins: string[];
  terminalReconciliationMode: GatewayTerminalReconciliationMode;
}

/**
 * 规范化 WebSocket Origin：只接受 `http(s)://host[:port]`，拒绝带路径、
 * query、hash、凭据（userinfo）或非法 URL 的输入。返回规范化字符串
 * （`new URL().origin`，无尾斜杠）或 null。握手时浏览器 Origin 也经过
 * 同一规范化后再与白名单比较，避免大小写/尾斜杠绕过。
 */
export function normalizeWsAllowedOrigin(raw: string): string | null {
  const value = raw.trim();
  if (value.length === 0 || value.length > 2_048) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username !== '' || url.password !== '') return null;
  // Origin 只含 scheme://host[:port]：任何路径/query/hash 都拒绝。
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '') {
    return null;
  }
  return url.origin;
}

export function readGatewayConfig(
  env: NodeJS.ProcessEnv = process.env,
): GatewayConfig {
  const rawPort = env.EDUCANVAS_GATEWAY_PORT ?? '3200';
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('EDUCANVAS_GATEWAY_PORT 必须是 1..65535 的整数');
  }
  const internalToken = env.EDUCANVAS_GATEWAY_INTERNAL_TOKEN?.trim() || null;
  if (internalToken !== null && Buffer.byteLength(internalToken) < 32) {
    throw new Error('EDUCANVAS_GATEWAY_INTERNAL_TOKEN 至少需要 32 字节');
  }
  const bootstrapToken = env.EDUCANVAS_GATEWAY_BOOTSTRAP_TOKEN?.trim() || null;
  const sessionSecret = env.EDUCANVAS_GATEWAY_SESSION_SECRET?.trim() || null;
  for (const [name, value] of [
    ['EDUCANVAS_GATEWAY_BOOTSTRAP_TOKEN', bootstrapToken],
    ['EDUCANVAS_GATEWAY_SESSION_SECRET', sessionSecret],
  ] as const) {
    if (value !== null && Buffer.byteLength(value) < 32) {
      throw new Error(`${name} 至少需要 32 字节`);
    }
  }
  if ((bootstrapToken === null) !== (sessionSecret === null)) {
    throw new Error(
      '公开 Client transport 必须同时配置 bootstrap token 与 session secret',
    );
  }
  const localUserId = env.EDUCANVAS_LOCAL_USER_ID?.trim() || 'local:owner';
  if (localUserId.length > 160) {
    throw new Error('EDUCANVAS_LOCAL_USER_ID 最多 160 字符');
  }
  // 实时语音 WS 握手 Origin 白名单；默认覆盖本地 Web（3000，见 README）
  // 的 127.0.0.1/localhost 两种访问形态。配置值逐个严格规范化：带路径、
  // 凭据或非法 URL 的项直接使配置失败（fail-closed）。
  const configured = (
    env.EDUCANVAS_GATEWAY_WS_ALLOWED_ORIGINS?.split(',').map((value) =>
      value.trim(),
    ) ?? []
  ).filter((value) => value.length > 0);
  const wsAllowedOrigins: string[] =
    configured.length > 0
      ? configured.map((value) => {
          const normalized = normalizeWsAllowedOrigin(value);
          if (normalized === null) {
            throw new Error(
              'EDUCANVAS_GATEWAY_WS_ALLOWED_ORIGINS 必须是 http(s)://host[:port] 列表，不允许路径、凭据或非法 URL',
            );
          }
          return normalized;
        })
      : ['http://127.0.0.1:3000', 'http://localhost:3000'];
  return {
    host: env.EDUCANVAS_GATEWAY_HOST?.trim() || '127.0.0.1',
    port,
    internalToken,
    bootstrapToken,
    sessionSecret,
    localOnboardingEnabled:
      env.EDUCANVAS_DEPLOYMENT_ENV?.trim() === 'local' &&
      ['127.0.0.1', 'localhost', '::1'].includes(
        env.EDUCANVAS_GATEWAY_HOST?.trim() || '127.0.0.1',
      ),
    localUserId,
    wsAllowedOrigins,
    terminalReconciliationMode: resolveGatewayTerminalReconciliationMode(
      env.EDUCANVAS_GATEWAY_TERMINAL_RECONCILIATION_MODE,
    ),
  };
}
