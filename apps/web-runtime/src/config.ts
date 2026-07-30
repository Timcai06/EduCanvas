export interface WebRuntimeConfig {
  host: string;
  port: number;
  publicOrigin: string;
  webOrigin: string;
}

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

/** Ports do not create a site boundary; local tests deliberately use hostname vs IP. */
export function schemefulSite(value: URL): string {
  return `${value.protocol}//${conservativeRegistrableHost(value.hostname)}`;
}

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
