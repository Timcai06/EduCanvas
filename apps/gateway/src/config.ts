export interface GatewayConfig {
  host: string;
  port: number;
  internalToken: string | null;
  bootstrapToken: string | null;
  sessionSecret: string | null;
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
  return {
    host: env.EDUCANVAS_GATEWAY_HOST?.trim() || '127.0.0.1',
    port,
    internalToken,
    bootstrapToken,
    sessionSecret,
  };
}
