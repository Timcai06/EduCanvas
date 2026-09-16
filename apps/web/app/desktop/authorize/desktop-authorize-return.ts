/** Rebuild the validated native-client request after browser login sets the session cookie. */
export function buildDesktopAuthorizeReturnPath(
  query: Record<string, string>,
): string {
  return `/desktop/authorize?${new URLSearchParams(query).toString()}`;
}
