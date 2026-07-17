import 'server-only';

/**
 * Cookie 认证写请求的最小同源校验。浏览器提供 Origin 时必须精确匹配；
 * 没有 Origin 的非浏览器调用仍会拒绝明确标记为 cross-site 的请求。
 */
export function isTrustedSameOriginWrite(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (origin) {
    try {
      const suppliedOrigin = new URL(origin).origin;
      if (suppliedOrigin === new URL(request.url).origin) return true;

      // Next.js 在本地/反向代理后可能把 Request.url 规范成内部 hostname；
      // 浏览器的 Origin 应与不可由前端脚本改写的 Host 精确匹配。
      const host = request.headers.get('host');
      if (!host || /[\s/,\\]/.test(host)) return false;
      const forwardedProtocol = request.headers
        .get('x-forwarded-proto')
        ?.split(',', 1)[0]
        ?.trim();
      const protocol = forwardedProtocol
        ? `${forwardedProtocol.replace(/:$/, '')}:`
        : new URL(request.url).protocol;
      if (protocol !== 'http:' && protocol !== 'https:') return false;
      return suppliedOrigin === `${protocol}//${host}`;
    } catch {
      return false;
    }
  }
  return request.headers.get('sec-fetch-site') !== 'cross-site';
}

export function jsonError(
  status: number,
  code: string,
  message: string,
  options: { retryAfterMs?: number } = {},
): Response {
  const headers = new Headers({
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
  });
  if (options.retryAfterMs !== undefined) {
    headers.set(
      'retry-after',
      String(Math.max(1, Math.ceil(options.retryAfterMs / 1_000))),
    );
  }
  return new Response(
    JSON.stringify({
      error: {
        code,
        message,
        ...(options.retryAfterMs === undefined
          ? {}
          : { retryAfterMs: options.retryAfterMs }),
      },
    }),
    { status, headers },
  );
}
