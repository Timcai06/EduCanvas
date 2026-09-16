/**
 * 本地健康探针 — Gateway/Web 的 HTTP 就绪探测。
 *
 * 被 local-startup（启动就绪）与 local-runtime-ops（status 探测）共用，
 * 避免两份实现漂移。Gateway 探测校验健康协议响应体
 * （service=educanvas-gateway + protocol=gateway.v1），不只是 2xx。
 */

/** 任意 HTTP 端点是否返回 2xx。 */
export async function probe(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * web-runtime 是否就绪。与 Gateway 同样校验响应体而不只是 2xx：
 * `isolationRequirement` 证明这确实是隔离 Runtime 在应答，而不是同端口上
 * 恰好起了别的服务。探针走绑定地址（127.0.0.1），不是对外的 publicOrigin。
 */
export async function webRuntimeProbe(runtimeHealthUrl) {
  try {
    const response = await fetch(runtimeHealthUrl, {
      signal: AbortSignal.timeout(1_000),
    });
    if (!response.ok) return false;
    const body = await response.json();
    return (
      body?.status === 'ok' &&
      body?.isolationRequirement === 'cross-site-configured'
    );
  } catch {
    return false;
  }
}

/** Gateway 是否按健康协议就绪（service + protocol 双字段校验）。 */
export async function gatewayProbe(gatewayUrl) {
  try {
    const response = await fetch(`${gatewayUrl}/healthz`, {
      signal: AbortSignal.timeout(1_000),
    });
    if (!response.ok) return false;
    const body = await response.json();
    return (
      body?.service === 'educanvas-gateway' && body?.protocol === 'gateway.v1'
    );
  } catch {
    return false;
  }
}
