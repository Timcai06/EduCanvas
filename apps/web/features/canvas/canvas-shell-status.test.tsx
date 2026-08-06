import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CanvasShellStatus } from './canvas-shell-status';

/**
 * W03 error matrix 组件层测试：每种稳定错误语义在 UI 上的可观察行为——
 * 无障碍 role、重试按钮可见性（键盘可达）、文案安全边界。
 */
describe('CanvasShellStatus 错误态渲染（W03 error matrix）', () => {
  it('forbidden 渲染 role="alert" 且不可重试（权限问题重试无意义）', () => {
    const html = renderToStaticMarkup(
      <CanvasShellStatus
        status="forbidden"
        title="无权访问"
        onRetry={() => undefined}
      />,
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain('无权访问');
    expect(html).not.toContain('重试');
  });

  it('not_found 渲染 role="alert" 且不可重试（资源缺失重试无意义）', () => {
    const html = renderToStaticMarkup(
      <CanvasShellStatus
        status="not_found"
        title="资源不存在"
        onRetry={() => undefined}
      />,
    );
    expect(html).toContain('role="alert"');
    expect(html).not.toContain('重试');
  });

  it('offline 渲染键盘可达的重试 <button>', () => {
    const html = renderToStaticMarkup(
      <CanvasShellStatus
        status="offline"
        title="离线"
        onRetry={() => undefined}
      />,
    );
    expect(html).toContain('role="alert"');
    expect(html).toMatch(/<button[\s\S]*>重试<\/button>/);
  });

  it('unavailable / failed 渲染重试按钮', () => {
    for (const status of ['unavailable', 'failed'] as const) {
      const html = renderToStaticMarkup(
        <CanvasShellStatus
          status={status}
          title="加载失败"
          onRetry={() => undefined}
        />,
      );
      expect(html).toContain('重试');
    }
  });

  it('可重试错误但未提供 onRetry 时不渲染重试按钮', () => {
    const html = renderToStaticMarkup(
      <CanvasShellStatus status="offline" title="离线" />,
    );
    expect(html).not.toContain('重试');
  });

  it('loading 渲染 role="status" + aria-busy="true"', () => {
    const html = renderToStaticMarkup(
      <CanvasShellStatus status="loading" title="加载中" />,
    );
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-busy="true"');
  });

  it('文案只透传稳定字符串，不泄露堆栈/内部对象键', () => {
    const html = renderToStaticMarkup(
      <CanvasShellStatus
        status="failed"
        title="加载失败"
        description="请稍后重试"
      />,
    );
    expect(html).not.toContain('stack');
    expect(html).not.toContain('Error:');
    expect(html).not.toContain('objectKey');
  });
});
