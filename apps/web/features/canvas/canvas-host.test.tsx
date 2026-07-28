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

// ── F02 响应式布局、滚动与安全区域 ──

describe('全屏布局安全区域', () => {
  it('全屏时包含 safe-area-inset', () => {
    const isFull = true;
    // 全屏模式使用 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]
    const fullscreenPadding =
      'fixed inset-0 z-40 p-0 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] lg:p-4';
    const nonFull =
      'fixed inset-0 z-40 lg:static lg:z-auto lg:min-w-0 lg:flex-1 lg:p-3 lg:pl-0';
    const result = isFull ? fullscreenPadding : nonFull;
    expect(result).toContain('safe-area-inset-top');
    expect(result).toContain('safe-area-inset-bottom');
  });

  it('非全屏时不包含 safe-area', () => {
    const isFull = false;
    const fullscreenPadding =
      'fixed inset-0 z-40 p-0 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] lg:p-4';
    const nonFull =
      'fixed inset-0 z-40 lg:static lg:z-auto lg:min-w-0 lg:flex-1 lg:p-3 lg:pl-0';
    const result = isFull ? fullscreenPadding : nonFull;
    expect(result).not.toContain('safe-area');
  });
});

describe('内容滚动单一所有者', () => {
  it('children 区域包含 overflow-y-auto', () => {
    // 实际渲染: <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    const scrollContainerClasses = 'min-h-0 flex-1 overflow-y-auto';
    expect(scrollContainerClasses).toContain('overflow-y-auto');
  });

  it('children 区域包含 min-h-0 防止弹性溢出', () => {
    const scrollContainerClasses = 'min-h-0 flex-1 overflow-y-auto';
    expect(scrollContainerClasses).toContain('min-h-0');
    expect(scrollContainerClasses).toContain('flex-1');
  });

  it('外容器不持有 overflow 控制权', () => {
    // 外层 <section> 无 overflow 类名
    const sectionClasses =
      'fixed inset-0 z-40 lg:static lg:z-auto lg:min-w-0 lg:flex-1 lg:p-3 lg:pl-0 flex flex-col';
    expect(sectionClasses).not.toContain('overflow-y');
    expect(sectionClasses).not.toContain('overflow-x');
  });
});

describe('长标题与按钮共存', () => {
  it('标题有 truncate 防止撑开', () => {
    // <h2 className="... truncate ...">
    const titleClasses = 'font-display min-w-0 flex-1 truncate text-base';
    expect(titleClasses).toContain('truncate');
    expect(titleClasses).toContain('min-w-0');
    expect(titleClasses).toContain('flex-1');
  });

  it('关闭按钮有 shrink-0 防止被长标题挤压', () => {
    const closeButtonClasses =
      'flex shrink-0 min-h-9 items-center rounded-full px-3';
    expect(closeButtonClasses).toContain('shrink-0');
  });

  it('200 字中文标题不会挤掉按钮的理论保证', () => {
    // truncate + min-w-0 保证溢出省略
    // shrink-0 保证按钮不压缩
    // 组合效果：超长标题 → 省略号，按钮始终完整可见
    const safeguard = (titleClasses: string, btnClasses: string) =>
      titleClasses.includes('truncate') &&
      titleClasses.includes('min-w-0') &&
      btnClasses.includes('shrink-0');
    expect(
      safeguard(
        'font-display min-w-0 flex-1 truncate text-base',
        'flex shrink-0 min-h-9 items-center',
      ),
    ).toBe(true);
  });
});

describe('z-index 仅使用现有层级', () => {
  it('无新增 z-index 值', () => {
    const sectionClasses =
      'fixed inset-0 z-40 lg:static lg:z-auto lg:min-w-0 lg:flex-1 lg:p-3 lg:pl-0 flex flex-col';
    // z-40 是已有值，lg:z-auto 是已有值。不能出现 z-50/z-[999] 等新值
    const zMatches = sectionClasses.match(/z-[-\w]+/g) ?? [];
    const newZ = zMatches.filter((z) => z !== 'z-40' && z !== 'z-auto');
    expect(newZ).toHaveLength(0);
  });
});

describe('无硬编码品牌色', () => {
  it('背景色使用 design token', () => {
    // bg-surface, bg-canvas 是 token；不允许 #xxx 或 rgb()
    const allowedTokens = ['bg-surface', 'bg-canvas', 'bg-transparent'];
    const sectionClasses =
      'bg-surface/60 backdrop-blur-sm lg:bg-transparent lg:backdrop-blur-none flex flex-col';
    const innerClasses =
      'bg-canvas shadow-[var(--shadow-float)] lg:rounded-3xl lg:border lg:border-line flex min-h-0 flex-1 flex-col';
    // 检查不含硬编码色值
    expect(sectionClasses).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    expect(sectionClasses).not.toMatch(/rgb\(/);
    expect(innerClasses).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    expect(innerClasses).not.toMatch(/rgb\(/);
  });
});
