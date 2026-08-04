function parsePort(value, fallback, name) {
  const port = Number(value ?? fallback);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${name} 必须是 1..65535 的整数`);
  }
  return port;
}

export function applyResolvedLocalPorts(env) {
  const port = parsePort(env.PORT, '3101', 'PORT');
  const gatewayPort = parsePort(
    env.EDUCANVAS_GATEWAY_PORT,
    '3200',
    'EDUCANVAS_GATEWAY_PORT',
  );

  // Turbo only forwards declared environment variables. Normalize defaults
  // before spawning it so Web and Gateway observe the same resolved ports.
  env.PORT = String(port);
  env.EDUCANVAS_GATEWAY_PORT = String(gatewayPort);
  return { port, gatewayPort };
}
