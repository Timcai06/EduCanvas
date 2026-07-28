import { describe, expect, it, vi } from 'vitest';
import {
  buildCloseAriaLabel,
  buildFullscreenAriaLabel,
  resolveEscapeAction,
  scheduleFocusRestore,
} from './canvas-host-utils';

// ── resolveEscapeAction ──

describe('resolveEscapeAction', () => {
  it('全屏且 onToggleFull 存在时返回 exit_fullscreen', () => {
    expect(resolveEscapeAction(true, true)).toBe('exit_fullscreen');
  });

  it('非全屏时返回 close', () => {
    expect(resolveEscapeAction(false, true)).toBe('close');
    expect(resolveEscapeAction(false, false)).toBe('close');
  });

  it('全屏但无 onToggleFull 时返回 close', () => {
    expect(resolveEscapeAction(true, false)).toBe('close');
  });
});

// ── Escape handler (uses resolveEscapeAction) ──

describe('Escape handler', () => {
  function mkEvent(key: string) {
    return { key, preventDefault: vi.fn() };
  }

  it('全屏 Escape 只调用 onToggleFull，不调用 onClose', () => {
    const onClose = vi.fn();
    const onToggleFull = vi.fn();

    const handleKeyDown = (
      event: Pick<KeyboardEvent, 'key' | 'preventDefault'>,
    ) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      const action = resolveEscapeAction(true, true);
      if (action === 'exit_fullscreen') {
        onToggleFull();
        scheduleFocusRestore(null);
      } else {
        onClose();
      }
    };

    handleKeyDown(mkEvent('Escape'));
    expect(onToggleFull).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('非全屏 Escape 只调用 onClose，不调用 onToggleFull', () => {
    const onClose = vi.fn();
    const onToggleFull = vi.fn();

    const handleKeyDown = (
      event: Pick<KeyboardEvent, 'key' | 'preventDefault'>,
    ) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      const action = resolveEscapeAction(false, false);
      if (action === 'exit_fullscreen') {
        onToggleFull();
      } else {
        onClose();
      }
    };

    handleKeyDown(mkEvent('Escape'));
    expect(onClose).toHaveBeenCalledOnce();
    expect(onToggleFull).not.toHaveBeenCalled();
  });

  it('非 Escape 键不触发任何回调', () => {
    const onClose = vi.fn();
    const onToggleFull = vi.fn();

    const handleKeyDown = (
      event: Pick<KeyboardEvent, 'key' | 'preventDefault'>,
    ) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      const action = resolveEscapeAction(true, true);
      if (action === 'exit_fullscreen') {
        onToggleFull();
      } else {
        onClose();
      }
    };

    handleKeyDown(mkEvent('Enter'));
    expect(onClose).not.toHaveBeenCalled();
    expect(onToggleFull).not.toHaveBeenCalled();
  });

  it('preventDefault 仅对 Escape 执行', () => {
    const preventDefault = vi.fn();

    const handleWithPrevent = (event: {
      key: string;
      preventDefault: () => void;
    }) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
    };

    handleWithPrevent({ key: 'Enter', preventDefault });
    expect(preventDefault).not.toHaveBeenCalled();

    handleWithPrevent({ key: 'Escape', preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce();
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
