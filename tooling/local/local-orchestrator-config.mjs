function parsePort(value, fallback, name) {
  const port = Number(value ?? fallback);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${name} 必须是 1..65535 的整数`);
  }
  return port;
}

export function applyResolvedLocalPorts(env) {
  const port = parsePort(env.PORT, '3000', 'PORT');
  const gatewayPort = parsePort(
    env.EDUCANVAS_GATEWAY_PORT,
    '3200',
    'EDUCANVAS_GATEWAY_PORT',
  );
  const runtimePort = parsePort(
    env.EDUCANVAS_WEB_RUNTIME_PORT,
    '3300',
    'EDUCANVAS_WEB_RUNTIME_PORT',
  );

  /*
   * web-runtime 必须与 Web 处于不同的 schemeful site，否则 readWebRuntimeConfig
   * 直接 fail closed（隔离边界不成立就拒绝启动）。`localhost` 与 `127.0.0.1`
   * 在该判定下是两个站点，因此本地默认取 Web=127.0.0.1、Runtime=localhost：
   * 既满足跨站隔离，又不必改动 `make dev` 打开的地址，也不需要 hosts 文件。
   * 端口不参与 site 判定，仅靠换端口无法形成边界。
   */
  const webOrigin =
    env.EDUCANVAS_WEB_PUBLIC_ORIGIN ?? `http://127.0.0.1:${port}`;
  const runtimeOrigin =
    env.EDUCANVAS_WEB_RUNTIME_PUBLIC_ORIGIN ??
    `http://localhost:${runtimePort}`;

  // Turbo only forwards declared environment variables. Normalize defaults
  // before spawning it so Web, Gateway and Runtime observe the same values.
  env.PORT = String(port);
  env.EDUCANVAS_GATEWAY_PORT = String(gatewayPort);
  env.EDUCANVAS_WEB_RUNTIME_PORT = String(runtimePort);
  env.EDUCANVAS_WEB_PUBLIC_ORIGIN = webOrigin;
  env.EDUCANVAS_WEB_RUNTIME_PUBLIC_ORIGIN = runtimeOrigin;
  return { port, gatewayPort, runtimePort, webOrigin, runtimeOrigin };
}
