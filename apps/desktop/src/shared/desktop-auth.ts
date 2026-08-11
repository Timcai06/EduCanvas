export type DesktopAuthStatus =
  | { state: 'signed_out' }
  | { state: 'authorizing' }
  | { state: 'signed_in' }
  | { state: 'error'; message: string };
