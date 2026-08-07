import { describe, expect, it, vi } from 'vitest';
import {
  buildCloseAriaLabel,
  buildCanvasHostPositionClass,
  buildFullscreenAriaLabel,
  CANVAS_CLOSE_BUTTON_CLASS,
  CANVAS_CONTENT_FRAME_CLASS,
  CANVAS_FULLSCREEN_BUTTON_CLASS,
  CANVAS_HOST_LAYOUT_CLASS,
  CANVAS_TITLE_CLASS,
  handleCanvasEscape,
  resolveEscapeAction,
  scheduleFocusRestore,
} from './canvas-host-utils';

// ── resolveEscapeAction ──

describe('resolveEscapeAction', () => {
  it('全屏且可退出全屏时返回 exit_fullscreen', () => {
    expect(resolveEscapeAction(true, true)).toBe('exit_fullscreen');
  });

  it('非全屏时返回 close', () => {
    expect(resolveEscapeAction(false, true)).toBe('close');
    expect(resolveEscapeAction(false, false)).toBe('close');
  });

  it('全屏但不可退出全屏（landing 强制全屏）时返回 close', () => {
    expect(resolveEscapeAction(true, false)).toBe('close');
  });
});

describe('handleCanvasEscape', () => {
  function mkEvent(key: string) {
    return { key, preventDefault: vi.fn() };
  }

  it('全屏 Escape 只调用 onToggleFull，不调用 onClose', () => {
    const onClose = vi.fn();
    const onToggleFull = vi.fn();
    const event = mkEvent('Escape');

    expect(
      handleCanvasEscape(event, {
        isFull: true,
        onClose,
        onToggleFull,
      }),
    ).toBe(true);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(onToggleFull).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('非全屏 Escape 只调用 onClose，不调用 onToggleFull', () => {
    const onClose = vi.fn();
    const onToggleFull = vi.fn();
    const event = mkEvent('Escape');

    expect(
      handleCanvasEscape(event, {
        isFull: false,
        onClose,
        onToggleFull,
      }),
    ).toBe(true);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
    expect(onToggleFull).not.toHaveBeenCalled();
  });

  it('非 Escape 键不触发任何回调', () => {
    const onClose = vi.fn();
    const onToggleFull = vi.fn();
    const event = mkEvent('Enter');

    expect(
      handleCanvasEscape(event, {
        isFull: true,
        onClose,
        onToggleFull,
      }),
    ).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(onToggleFull).not.toHaveBeenCalled();
  });

  it('退出全屏后把焦点恢复到全屏按钮', async () => {
    const focus = vi.fn();
    const fullscreenButton = { focus } as unknown as HTMLElement;

    handleCanvasEscape(mkEvent('Escape'), {
      isFull: true,
      onClose: vi.fn(),
      onToggleFull: vi.fn(),
      fullscreenButton,
    });
    await Promise.resolve();

    expect(focus).toHaveBeenCalledOnce();
  });

  it('landing 强制全屏（onToggleFull 是 no-op）时 Escape 直接关闭', () => {
    const onClose = vi.fn();
    const onToggleFull = vi.fn();
    const event = mkEvent('Escape');

    expect(
      handleCanvasEscape(event, {
        isFull: true,
        onClose,
        // 模拟 landing 分支的 no-op 占位；canExitFullscreen=false 必须压过它
        onToggleFull,
        canExitFullscreen: false,
      }),
    ).toBe(true);
    expect(onClose).toHaveBeenCalledOnce();
    expect(onToggleFull).not.toHaveBeenCalled();
  });

  it('canExitFullscreen 显式覆盖 onToggleFull 推断', () => {
    const onClose = vi.fn();
    const onToggleFull = vi.fn();

    handleCanvasEscape(mkEvent('Escape'), {
      isFull: true,
      onClose,
      onToggleFull,
      canExitFullscreen: true,
    });

    expect(onToggleFull).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
  });
});

// ── scheduleFocusRestore ──

describe('scheduleFocusRestore', () => {
  it('元素有效时调度一次 focus', async () => {
    const focus = vi.fn();
    const element = { focus } as unknown as HTMLElement;

    scheduleFocusRestore(element);
    // queueMicrotask 在 microtask 队列中执行，用 Promise 等待
    await Promise.resolve();
    expect(focus).toHaveBeenCalledOnce();
  });

  it('null 时静默跳过不抛异常', async () => {
    scheduleFocusRestore(null);
    await Promise.resolve();
    // 不抛异常即通过
  });

  it('undefined 时静默跳过不抛异常', async () => {
    scheduleFocusRestore(undefined);
    await Promise.resolve();
  });
});

// ── buildCloseAriaLabel ──

describe('buildCloseAriaLabel', () => {
  it('显式传入 aria-label 优先生效', () => {
    expect(buildCloseAriaLabel('关闭面板', '返回对话')).toBe('关闭面板');
  });

  it('未传入时复用可见文案', () => {
    expect(buildCloseAriaLabel(undefined, '返回对话')).toBe('返回对话');
  });
});

// ── buildFullscreenAriaLabel ──

describe('buildFullscreenAriaLabel', () => {
  it('全屏时返回"退出全屏"', () => {
    expect(buildFullscreenAriaLabel(true)).toBe('退出全屏');
  });

  it('非全屏时返回"全屏"', () => {
    expect(buildFullscreenAriaLabel(false)).toBe('全屏');
  });
});

describe('CanvasHost 响应式布局契约', () => {
  it('全屏覆盖四向安全区域并沿用现有 z-40 层级', () => {
    const classes = buildCanvasHostPositionClass(true);

    expect(classes).toContain('safe-area-inset-top');
    expect(classes).toContain('safe-area-inset-right');
    expect(classes).toContain('safe-area-inset-bottom');
    expect(classes).toContain('safe-area-inset-left');
    expect(classes).toContain('z-40');
    expect(classes).not.toMatch(/z-\[(?:\d+)\]/);
  });

  it('窄屏固定覆盖，桌面恢复静态分栏且允许收缩', () => {
    const classes = buildCanvasHostPositionClass(false);

    expect(classes).toContain('fixed');
    expect(classes).toContain('inset-0');
    expect(classes).toContain('lg:static');
    expect(classes).toContain('lg:min-w-0');
    expect(classes).toContain('lg:flex-1');
  });

  it('宿主裁切溢出而不成为第二个滚动所有者', () => {
    expect(CANVAS_HOST_LAYOUT_CLASS).toContain('min-h-0');
    expect(CANVAS_HOST_LAYOUT_CLASS).toContain('overflow-hidden');
    expect(CANVAS_CONTENT_FRAME_CLASS).toContain('flex-col');
    expect(CANVAS_CONTENT_FRAME_CLASS).toContain('min-h-0');
    expect(CANVAS_CONTENT_FRAME_CLASS).toContain('overflow-hidden');
    expect(CANVAS_CONTENT_FRAME_CLASS).not.toContain('overflow-y-auto');
  });

  it('长标题截断，两个操作按钮都不可被压缩', () => {
    expect(CANVAS_TITLE_CLASS).toContain('truncate');
    expect(CANVAS_TITLE_CLASS).toContain('min-w-0');
    expect(CANVAS_CLOSE_BUTTON_CLASS).toContain('shrink-0');
    expect(CANVAS_FULLSCREEN_BUTTON_CLASS).toContain('shrink-0');
  });

  it('布局契约只使用 design token，不含硬编码颜色', () => {
    const classes = [
      buildCanvasHostPositionClass(false),
      buildCanvasHostPositionClass(true),
      CANVAS_TITLE_CLASS,
      CANVAS_CLOSE_BUTTON_CLASS,
      CANVAS_FULLSCREEN_BUTTON_CLASS,
      CANVAS_CONTENT_FRAME_CLASS,
    ].join(' ');

    expect(classes).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    expect(classes).not.toMatch(/rgb\(/);
  });
});
