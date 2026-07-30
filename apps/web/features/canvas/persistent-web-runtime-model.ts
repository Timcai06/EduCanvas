import type { WebRuntimeSessionState } from '@educanvas/canvas-protocol';

export type PersistentRuntimeState =
  'starting' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export function resolveCancelFailure(
  current: PersistentRuntimeState,
): PersistentRuntimeState {
  return current === 'succeeded' ||
    current === 'failed' ||
    current === 'cancelled'
    ? current
    : 'failed';
}

export function shouldIgnoreRuntimeEvent(
  session: WebRuntimeSessionState,
): boolean {
  return session.terminal !== null;
}

export function runtimeRequestCancelPath(requestId: string): string {
  return `/api/v1/canvas/runtime/requests/${encodeURIComponent(requestId)}/cancel`;
}
