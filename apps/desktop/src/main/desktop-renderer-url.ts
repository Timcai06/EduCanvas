export function isTrustedDesktopRendererUrl(
  candidate: string,
  rendererEntryUrl: string,
): boolean {
  try {
    const next = new URL(candidate);
    const entry = new URL(rendererEntryUrl);
    return (
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
