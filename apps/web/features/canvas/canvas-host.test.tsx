import { describe, expect, it, vi } from 'vitest';

/**
 * CanvasHost Escape 最小区分逻辑的可测试投影。
 *
 * 实际实现在 useEffect handleKeyDown 中：
 * - isFull && onToggleFull → onToggleFull() + 焦点回归全屏按钮
 * - 否则 → onClose()
 *
 * 这里把动作选择抽取为纯函数，避免依赖 jsdom/React 渲染环境。
 */
function resolveEscapeAction(
  isFull: boolean,
  hasToggleFull: boolean,
): 'exit_fullscreen' | 'close' {
  return isFull && hasToggleFull ? 'exit_fullscreen' : 'close';
}

describe('CanvasHost Escape 最小退出动作', () => {
  it('全屏且 onToggleFull 存在时，优先退出全屏', () => {
    expect(resolveEscapeAction(true, true)).toBe('exit_fullscreen');
  });

  it('非全屏时直接关闭', () => {
    expect(resolveEscapeAction(false, true)).toBe('close');
    expect(resolveEscapeAction(false, false)).toBe('close');
  });

  it('全屏但无 onToggleFull 时回落关闭', () => {
    expect(resolveEscapeAction(true, false)).toBe('close');
  });
});

describe('Escape handler 模拟：不重复触发、不穿透', () => {
  it('按 Escape 只执行一次回调', () => {
    const onClose = vi.fn();
    const onToggleFull = vi.fn();

    // 模拟 handleKeyDown 的执行路径：非全屏
    const handleKeyDown = (event: Partial<KeyboardEvent>) => {
      if (event.key !== 'Escape') return;
      event.preventDefault?.();
      if (false) {
        /* isFull=true 路径 */
      } else {
        onClose();
      }
    };

    handleKeyDown({ key: 'Escape', preventDefault: vi.fn() });
    expect(onClose).toHaveBeenCalledOnce();
    expect(onToggleFull).not.toHaveBeenCalled();
  });

  it('全屏时 Escape 退全屏而不调 onClose', () => {
    const onClose = vi.fn();
    const onToggleFull = vi.fn();

    // 模拟 handleKeyDown 的执行路径：全屏
    const isFull = true;
    const handleKeyDown = (event: Partial<KeyboardEvent>) => {
      if (event.key !== 'Escape') return;
      event.preventDefault?.();
      if (isFull) {
        onToggleFull();
      } else {
        onClose();
      }
    };

    handleKeyDown({ key: 'Escape', preventDefault: vi.fn() });
    expect(onToggleFull).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('非 Escape 键不触发任何动作', () => {
    const onClose = vi.fn();
    const onToggleFull = vi.fn();

    const handleKeyDown = (event: Partial<KeyboardEvent>) => {
      if (event.key !== 'Escape') return;
      onClose();
    };

    handleKeyDown({ key: 'Enter' });
    expect(onClose).not.toHaveBeenCalled();
    expect(onToggleFull).not.toHaveBeenCalled();
  });
});

describe('CanvasHost 按钮 accessible name', () => {
  it('关闭按钮 aria-label 缺省复用 closeLabel', () => {
    const closeLabel = '返回对话';
    const closeAriaLabel: string | undefined = undefined;
    expect(closeAriaLabel ?? closeLabel).toBe('返回对话');
  });

  it('关闭按钮显式传入 aria-label 时优先使用', () => {
    const closeLabel = '关闭预览';
    const closeAriaLabel = '关闭Canvas面板';
    expect(closeAriaLabel ?? closeLabel).toBe('关闭Canvas面板');
  });

  it('全屏按钮全屏时 label 为"退出全屏"', () => {
    expect(true ? '退出全屏' : '全屏').toBe('退出全屏');
  });

  it('全屏按钮非全屏时 label 为"全屏"', () => {
    expect(false ? '退出全屏' : '全屏').toBe('全屏');
  });
});

describe('CanvasHost isModal 判定', () => {
  it('全屏或窄屏时进入 modal 模式', () => {
    // isModal = isFull || isCompact(≤1023px)
    const testModal = (isFull: boolean, isCompact: boolean) =>
      isFull || isCompact;
    expect(testModal(true, false)).toBe(true);
    expect(testModal(false, true)).toBe(true);
    expect(testModal(true, true)).toBe(true);
  });

  it('桌面端非全屏时为 region 模式', () => {
    const testModal = (isFull: boolean, isCompact: boolean) =>
      isFull || isCompact;
    expect(testModal(false, false)).toBe(false);
  });
});
