import 'server-only';

export class WebRuntimeHostConfigurationError extends Error {
  readonly code = 'runtime_unavailable';
}

function parseOrigin(value: string | undefined): URL {
  if (!value) throw new WebRuntimeHostConfigurationError();
  try {
    const parsed = new URL(value);
    if (
      parsed.origin !== value ||
      !['http:', 'https:'].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password
    ) {
      throw new WebRuntimeHostConfigurationError();
    }
    return parsed;
  } catch {
    throw new WebRuntimeHostConfigurationError();
  }
}

function siteHost(hostname: string): string {
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

const site = (url: URL): string => `${url.protocol}//${siteHost(url.hostname)}`;

export function readWebRuntimeHostConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): { runtimeOrigin: string; webOrigin: string } {
  const runtime = parseOrigin(environment.EDUCANVAS_WEB_RUNTIME_PUBLIC_ORIGIN);
  const web = parseOrigin(environment.EDUCANVAS_WEB_PUBLIC_ORIGIN);
  if (site(runtime) === site(web)) throw new WebRuntimeHostConfigurationError();
  if (
    environment.EDUCANVAS_DEPLOYMENT_ENV === 'production' &&
    (runtime.protocol !== 'https:' || web.protocol !== 'https:')
  ) {
    throw new WebRuntimeHostConfigurationError();
  }
  return { runtimeOrigin: runtime.origin, webOrigin: web.origin };
}
