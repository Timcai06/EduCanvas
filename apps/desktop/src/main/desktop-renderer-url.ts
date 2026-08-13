export function isTrustedDesktopRendererUrl(
  candidate: string,
  rendererEntryUrl: string,
  development = false,
): boolean {
  try {
    const next = new URL(candidate);
    const entry = new URL(rendererEntryUrl);
    const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
    const trustedEntry =
      entry.protocol === 'file:' ||
      (development &&
        entry.protocol === 'http:' &&
        loopbackHosts.has(entry.hostname));
    return (
      trustedEntry &&
      next.protocol === entry.protocol &&
      next.origin === entry.origin &&
      next.pathname === entry.pathname &&
      (next.search === '' || next.search === '?view=chat') &&
      next.hash === ''
    );
  } catch {
    return false;
  }
}
