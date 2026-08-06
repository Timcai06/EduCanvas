import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
// vitest 默认 node 环境（无 window/location）：导入成功即证明模块顶层不读取浏览器全局。
import { useWorkspaceSurface } from './use-workspace-surface';
import { INITIAL_SURFACE } from './workspace-surface';

function SurfaceProbe() {
  const { surface } = useWorkspaceSurface();
  return <div data-surface={surface.type}>{surface.type}</div>;
}

describe('useWorkspaceSurface SSR 安全与初始态', () => {
  it('模块顶层不读取浏览器全局，SSR 可安全渲染', () => {
    const html = renderToStaticMarkup(<SurfaceProbe />);
    expect(html).toContain('data-surface="none"');
  });

  it('桥接 hook 以 W01 reducer 的 INITIAL_SURFACE 为初始态（none）', () => {
    // hook 只能在组件内调用；这里校验桥接所依赖的状态常量，确保起步语义一致。
    expect(INITIAL_SURFACE).toEqual({ type: 'none' });
  });
});
