export const CANVAS_SHELL_STATUSES = [
  'loading',
  'empty',
  'failed',
  'unavailable',
  'denied',
] as const;

export type CanvasShellStatusKind = (typeof CANVAS_SHELL_STATUSES)[number];

export const CANVAS_SHELL_COPY_CLASS =
  'min-w-0 max-w-sm break-words text-sm text-ink-muted';

export function getCanvasShellStatusRole(
  status: CanvasShellStatusKind,
): 'status' | 'alert' {
  return status === 'failed' || status === 'unavailable' || status === 'denied'
    ? 'alert'
    : 'status';
}

export function canRetryCanvasShellStatus(
  status: CanvasShellStatusKind,
  onRetry: (() => void) | undefined,
): boolean {
  return (
    (status === 'failed' || status === 'unavailable') && onRetry !== undefined
  );
}

export function isCanvasShellStatusBusy(
  status: CanvasShellStatusKind,
): true | undefined {
  return status === 'loading' ? true : undefined;
}

export function resolveCanvasShellRetryLabel(
  retryLabel: string | undefined,
): string {
  return retryLabel ?? '重试';
}
