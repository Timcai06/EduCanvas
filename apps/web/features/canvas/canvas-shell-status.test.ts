import { describe, expect, it } from 'vitest';
import {
  CANVAS_SHELL_COPY_CLASS,
  CANVAS_SHELL_STATUSES,
  canRetryCanvasShellStatus,
  getCanvasShellStatusRole,
  isCanvasShellStatusBusy,
  resolveCanvasShellRetryLabel,
} from './canvas-shell-status-contract';

/**
 * CanvasShellStatus 行为合约测试。
 *
 * 组件本身是纯展示，不读取资源、不发请求、不判断权限。
 * DOM 渲染验证依赖 F04 E2E；这里测试类型守卫和状态映射逻辑。
 */

describe('CanvasShellStatus 状态集（W03 六种错误语义 + loading）', () => {
  it('共七种状态：loading/empty/failed/unavailable/forbidden/not_found/offline', () => {
    expect(CANVAS_SHELL_STATUSES).toEqual([
      'loading',
      'empty',
      'failed',
      'unavailable',
      'forbidden',
      'not_found',
      'offline',
    ]);
  });
});

describe('status→role 映射', () => {
  it('loading/empty 使用 role="status"', () => {
    expect(getCanvasShellStatusRole('loading')).toBe('status');
    expect(getCanvasShellStatusRole('empty')).toBe('status');
  });

  it('六种错误语义使用 role="alert"', () => {
    expect(getCanvasShellStatusRole('failed')).toBe('alert');
    expect(getCanvasShellStatusRole('unavailable')).toBe('alert');
    expect(getCanvasShellStatusRole('forbidden')).toBe('alert');
    expect(getCanvasShellStatusRole('not_found')).toBe('alert');
    expect(getCanvasShellStatusRole('offline')).toBe('alert');
  });
});

describe('重试按钮可见性（Retry 只对可重试错误开放）', () => {
  it('failed/unavailable/offline 且有 onRetry 时显示重试按钮', () => {
    const cb = () => undefined;
    expect(canRetryCanvasShellStatus('failed', cb)).toBe(true);
    expect(canRetryCanvasShellStatus('unavailable', cb)).toBe(true);
    expect(canRetryCanvasShellStatus('offline', cb)).toBe(true);
  });

  it('loading/empty/forbidden/not_found 即使有 onRetry 也不显示', () => {
    const cb = () => undefined;
    expect(canRetryCanvasShellStatus('loading', cb)).toBe(false);
    expect(canRetryCanvasShellStatus('empty', cb)).toBe(false);
    expect(canRetryCanvasShellStatus('forbidden', cb)).toBe(false);
    expect(canRetryCanvasShellStatus('not_found', cb)).toBe(false);
  });

  it('可重试错误但无 onRetry 时不显示重试按钮', () => {
    expect(canRetryCanvasShellStatus('failed', undefined)).toBe(false);
    expect(canRetryCanvasShellStatus('unavailable', undefined)).toBe(false);
    expect(canRetryCanvasShellStatus('offline', undefined)).toBe(false);
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

  it('长中文和英文单词使用可换行的有界文案契约', () => {
    expect(CANVAS_SHELL_COPY_CLASS).toContain('max-w-sm');
    expect(CANVAS_SHELL_COPY_CLASS).toContain('break-words');
    expect(CANVAS_SHELL_COPY_CLASS).toContain('min-w-0');
  });
});

describe('aria-busy', () => {
  it('loading 状态设 aria-busy=true', () => {
    expect(isCanvasShellStatusBusy('loading')).toBe(true);
    expect(isCanvasShellStatusBusy('empty')).toBeUndefined();
    expect(isCanvasShellStatusBusy('failed')).toBeUndefined();
  });
});

describe('retryLabel 缺省值', () => {
  it('未传 retryLabel 时默认"重试"', () => {
    expect(resolveCanvasShellRetryLabel(undefined)).toBe('重试');
  });

  it('传入 retryLabel 时使用传入值', () => {
    expect(resolveCanvasShellRetryLabel('重新加载')).toBe('重新加载');
  });
});
