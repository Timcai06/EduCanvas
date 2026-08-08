/**
 * Escape 最小退出动作：可退出全屏时退出全屏，否则关闭。
 *
 * canExitFullscreen 是「当前全屏态是否真的允许退出」，它不等于「是否有全屏切换
 * 按钮」：landing 强制全屏时按钮存在（onToggleFull 是 no-op 占位）但退全屏没有
 * 意义，此时 Escape 必须直接关闭而非调用无效切换。landing 分支在
 * workspace-surface-slot 显式传 canExitFullscreen={!fullscreen}。
 */
export function resolveEscapeAction(
  isFull: boolean,
  canExitFullscreen: boolean,
): 'exit_fullscreen' | 'close' {
  return isFull && canExitFullscreen ? 'exit_fullscreen' : 'close';
}

/** 调度微任务恢复焦点；元素不存在时静默跳过。 */
export function scheduleFocusRestore(
  element: HTMLElement | null | undefined,
): void {
  queueMicrotask(() => element?.focus());
}

/** 关闭按钮优先使用显式 accessible name，否则复用可见文案。 */
export function buildCloseAriaLabel(
  closeAriaLabel: string | undefined,
  closeLabel: string,
): string {
  return closeAriaLabel ?? closeLabel;
}

/** 全屏切换按钮的稳定 accessible name。 */
export function buildFullscreenAriaLabel(isFull: boolean): string {
  return isFull ? '退出全屏' : '全屏';
}

export const CANVAS_HOST_FULLSCREEN_POSITION_CLASS =
  'fixed inset-0 z-40 p-0 pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] lg:p-4';

export const CANVAS_HOST_DOCKED_POSITION_CLASS =
  'fixed inset-0 z-40 lg:static lg:z-auto lg:min-w-0 lg:flex-1 lg:p-3 lg:pl-0';

export const CANVAS_TITLE_CLASS =
  'font-display min-w-0 flex-1 truncate text-base font-semibold text-ink';

export const CANVAS_FULLSCREEN_BUTTON_CLASS =
  'hidden min-h-9 shrink-0 items-center rounded-full px-3 text-sm text-ink-muted transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent lg:flex';

export const CANVAS_CLOSE_BUTTON_CLASS =
  'flex min-h-9 shrink-0 items-center rounded-full px-3 text-sm text-ink-muted transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent';

export const CANVAS_HOST_LAYOUT_CLASS =
  'flex min-h-0 flex-col overflow-hidden bg-surface/60 backdrop-blur-sm lg:bg-transparent lg:backdrop-blur-none';

/**
 * Host 只裁切外层溢出，具体滚动由各 Renderer 的内容容器持有，
 * 避免宿主与消费者同时出现纵向滚动条。
 */
export const CANVAS_CONTENT_FRAME_CLASS =
  'flex min-h-0 flex-1 flex-col overflow-hidden';

export function buildCanvasHostPositionClass(isFull: boolean): string {
  return isFull
    ? CANVAS_HOST_FULLSCREEN_POSITION_CLASS
    : CANVAS_HOST_DOCKED_POSITION_CLASS;
}

/**
 * 处理 Canvas 的 Escape 行为。
 * 返回 true 表示事件已消费；全屏时只退出全屏，否则只关闭 Canvas。
 */
export function handleCanvasEscape(
  event: Pick<KeyboardEvent, 'key' | 'preventDefault'>,
  {
    isFull,
    onClose,
    onToggleFull,
    fullscreenButton,
    canExitFullscreen,
  }: {
    isFull: boolean;
    onClose: () => void;
    onToggleFull?: () => void;
    fullscreenButton?: HTMLElement | null;
    /** 覆盖「onToggleFull 存在即可退全屏」的推断；landing 强制全屏传 false。 */
    canExitFullscreen?: boolean;
  },
): boolean {
  if (event.key !== 'Escape') return false;

  event.preventDefault();
  if (
    resolveEscapeAction(
      isFull,
      canExitFullscreen ?? onToggleFull !== undefined,
    ) === 'exit_fullscreen'
  ) {
    onToggleFull!();
    scheduleFocusRestore(fullscreenButton);
  } else {
    onClose();
  }
  return true;
}
