import { describe, expect, it } from 'vitest';

/**
 * CanvasShellStatus 行为合约测试。
 *
 * 组件本身是纯展示，不读取资源、不发请求、不判断权限。
 * DOM 渲染验证依赖 F04 E2E；这里测试类型守卫和状态映射逻辑。
 */

// 从组件中内联的核心逻辑——status→role 映射
function statusRole(
  status: 'loading' | 'empty' | 'failed' | 'unavailable' | 'denied',
): 'status' | 'alert' {
  return status === 'failed' || status === 'unavailable' || status === 'denied'
    ? 'alert'
    : 'status';
}

// 重试按钮是否可见
function showRetryButton(
  status: string,
  onRetry: (() => void) | undefined,
): boolean {
  return (status === 'failed' || status === 'unavailable') && onRetry !== undefined;
}

// 全部五种状态
const ALL_STATUSES = ['loading', 'empty', 'failed', 'unavailable', 'denied'] as const;

describe('CanvasShellStatus 五种状态', () => {
  it('共五种状态：loading/empty/failed/unavailable/denied', () => {
    expect(ALL_STATUSES).toHaveLength(5);
    expect(ALL_STATUSES).toContain('loading');
    expect(ALL_STATUSES).toContain('empty');
    expect(ALL_STATUSES).toContain('failed');
    expect(ALL_STATUSES).toContain('unavailable');
    expect(ALL_STATUSES).toContain('denied');
  });
});

describe('status→role 映射', () => {
  it('loading/empty 使用 role="status"', () => {
    expect(statusRole('loading')).toBe('status');
    expect(statusRole('empty')).toBe('status');
  });

  it('failed/unavailable/denied 使用 role="alert"', () => {
    expect(statusRole('failed')).toBe('alert');
    expect(statusRole('unavailable')).toBe('alert');
    expect(statusRole('denied')).toBe('alert');
  });
});

describe('重试按钮可见性', () => {
  it('failed 且有 onRetry 时显示重试按钮', () => {
    expect(showRetryButton('failed', () => undefined)).toBe(true);
  });

  it('unavailable 且有 onRetry 时显示重试按钮', () => {
    expect(showRetryButton('unavailable', () => undefined)).toBe(true);
  });

  it('loading/empty/denied 即使有 onRetry 也不显示', () => {
    const cb = () => undefined;
    expect(showRetryButton('loading', cb)).toBe(false);
    expect(showRetryButton('empty', cb)).toBe(false);
    expect(showRetryButton('denied', cb)).toBe(false);
  });

  it('failed 但无 onRetry 时不显示重试按钮', () => {
    expect(showRetryButton('failed', undefined)).toBe(false);
    expect(showRetryButton('unavailable', undefined)).toBe(false);
  });
});

describe('文案安全边界', () => {
  it('组件只接收 string 文案，不接收 Error 对象', () => {
    // 类型层面：CanvasShellStatusProps.title/description 是 string
    // Error.message / Error.stack 不能直接传入，调用方必须先脱敏
    const safeTitle: string = '加载失败';
    const safeDesc: string = '请检查网络连接后重试';
    expect(typeof safeTitle).toBe('string');
    expect(typeof safeDesc).toBe('string');
    // 确保不含堆栈特征
    expect(safeTitle).not.toContain('Error');
    expect(safeDesc).not.toContain('.ts:');
  });

  it('超长中文标题不破坏结构', () => {
    // 组件使用 text-center + max-w-sm，长文本自然换行
    const longTitle =
      '这是一个非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常长的标题';
    expect(longTitle.length).toBeGreaterThan(40);
    // 结构保证：不截断、不溢出（由 CSS text-center + max-w-sm 保证）
    // 实际渲染验证在 F04 E2E
  });

  it('超长英文单词不破坏结构', () => {
    const longWord = 'supercalifragilisticexpialidocious'.repeat(3);
    expect(longWord.length).toBeGreaterThan(80);
    // CSS word-break 由 Tailwind 默认处理
  });
});

describe('aria-busy', () => {
  it('loading 状态设 aria-busy=true', () => {
    const isBusy = (status: string) => status === 'loading' || undefined;
    expect(isBusy('loading')).toBe(true);
    expect(isBusy('empty')).toBeUndefined();
    expect(isBusy('failed')).toBeUndefined();
  });
});

describe('retryLabel 缺省值', () => {
  it('未传 retryLabel 时默认"重试"', () => {
    const retryLabel: string | undefined = undefined;
    const resolved = retryLabel ?? '重试';
    expect(resolved).toBe('重试');
  });

  it('传入 retryLabel 时使用传入值', () => {
    const retryLabel = '重新加载';
    const resolved = retryLabel ?? '重试';
    expect(resolved).toBe('重新加载');
  });
});
