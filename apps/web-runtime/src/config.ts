export interface WebRuntimeConfig {
  /** Runtime HTTP server bind host, defaults to 127.0.0.1 when not provided. */
  host: string;
  /** Runtime listen port; must be a safe integer in [1,65535]. */
  port: number;
  /** Origin that serves the isolated runtime host page (/host). */
  publicOrigin: string;
  /** Origin of the host web application; used for postMessage target and CSP frame-ancestors. */
  webOrigin: string;
}

/**
 * Configuration parsing failed for web-runtime bootstrapping.
 * We intentionally use a narrow error type so callers can fail closed
 * without leaking origin or token details to external callers.
 */
export class WebRuntimeConfigurationError extends Error {
  readonly code = 'runtime_configuration_invalid';
}

function origin(value: string | undefined): URL {
  if (!value) throw new WebRuntimeConfigurationError();
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new WebRuntimeConfigurationError();
  }
  if (
    parsed.origin !== value ||
    !['http:', 'https:'].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password
  ) {
    throw new WebRuntimeConfigurationError();
  }
  return parsed;
}

function conservativeRegistrableHost(hostname: string): string {
  if (
    hostname === 'localhost' ||
    /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) ||
    hostname.includes(':')
  ) {
    return hostname;
  }
  const labels = hostname.toLowerCase().split('.');
  return labels.slice(Math.max(0, labels.length - 2)).join('.');
}

/**
 * Compute schemeful site string for same-site enforcement.
 *
 * 1) Ports are ignored intentionally in site matching.
 * 2) localhost and IP literals keep exact host for testability.
 * 3) For normal hostnames we use a conservative last-two-label approximation;
 *    this is not a Public Suffix List parser, so deployment hostnames must avoid ambiguous suffixes.
 */
export function schemefulSite(value: URL): string {
  return `${value.protocol}//${conservativeRegistrableHost(value.hostname)}`;
}

/**
 * Read and validate web-runtime config from environment.
 *
 * Security invariants:
 * - public origin and web origin must be different schemeful sites to form a browser boundary.
 * - in production both must be HTTPS.
 * - bootstrap endpoints can only parse clean absolute HTTP/HTTPS origins without creds.
 * - bind port must be a strict integer range within valid TCP ports.
 */
export function readWebRuntimeConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): WebRuntimeConfig {
  const publicUrl = origin(environment.EDUCANVAS_WEB_RUNTIME_PUBLIC_ORIGIN);
  const webUrl = origin(environment.EDUCANVAS_WEB_PUBLIC_ORIGIN);
  if (schemefulSite(publicUrl) === schemefulSite(webUrl)) {
    throw new WebRuntimeConfigurationError();
  }
  const port = Number(environment.EDUCANVAS_WEB_RUNTIME_PORT ?? '3300');
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new WebRuntimeConfigurationError();
  }
  const deployment = environment.EDUCANVAS_DEPLOYMENT_ENV ?? 'local';
  if (
    deployment === 'production' &&
    (publicUrl.protocol !== 'https:' || webUrl.protocol !== 'https:')
  ) {
    throw new WebRuntimeConfigurationError();
  }
  return {
    host: environment.EDUCANVAS_WEB_RUNTIME_HOST?.trim() || '127.0.0.1',
    port,
    publicOrigin: publicUrl.origin,
    webOrigin: webUrl.origin,
  };
}
