/** Escape 最小退出动作：全屏时退出全屏，非全屏时关闭。 */
export function resolveEscapeAction(
  isFull: boolean,
  hasToggleFull: boolean,
): 'exit_fullscreen' | 'close' {
  return isFull && hasToggleFull ? 'exit_fullscreen' : 'close';
}

/** 调度微任务恢复焦点至指定元素；元素为 null/undefined 时静默跳过。 */
export function scheduleFocusRestore(
  element: HTMLElement | null | undefined,
): void {
  queueMicrotask(() => element?.focus());
}

/** 关闭按钮 accessible name：显式传入 aria-label 优先生效，否则复用可见文案。 */
export function buildCloseAriaLabel(
  closeAriaLabel: string | undefined,
  closeLabel: string,
): string {
  return closeAriaLabel ?? closeLabel;
}

/** 全屏切换按钮 accessible name。 */
export function buildFullscreenAriaLabel(isFull: boolean): string {
  return isFull ? '退出全屏' : '全屏';
}
