/* W03：六种错误语义（empty/unavailable/forbidden/not_found/failed/offline）+ loading。
   原 denied 统一为 forbidden；新增 not_found 与 offline。 */
export const CANVAS_SHELL_STATUSES = [
  'loading',
  'empty',
  'failed',
  'unavailable',
  'forbidden',
  'not_found',
  'offline',
] as const;

export type CanvasShellStatusKind = (typeof CANVAS_SHELL_STATUSES)[number];

export const CANVAS_SHELL_COPY_CLASS =
  'min-w-0 max-w-sm break-words text-sm text-ink-muted';

export function getCanvasShellStatusRole(
  status: CanvasShellStatusKind,
): 'status' | 'alert' {
  return status === 'loading' || status === 'empty' ? 'status' : 'alert';
}

/* Retry 只对可重试错误开放：网络/服务瞬时问题可重试；权限、资源缺失、空态重试无意义。 */
export function canRetryCanvasShellStatus(
  status: CanvasShellStatusKind,
  onRetry: (() => void) | undefined,
): boolean {
  return (
    (status === 'failed' || status === 'unavailable' || status === 'offline') &&
    onRetry !== undefined
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
