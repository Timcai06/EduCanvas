import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Banner } from './banner';

describe('Banner', () => {
  it('info 默认 status 角色 + 墨紫语义类', () => {
    const html = renderToStaticMarkup(<Banner title="提示" />);
    expect(html).toContain('role="status"');
    expect(html).toContain('bg-accent-soft/60');
  });

  it('error 用 alert 角色 + 退出容错色', () => {
    const html = renderToStaticMarkup(<Banner tone="error" title="出错" />);
    expect(html).toContain('role="alert"');
    expect(html).toContain('bg-bad-soft/60');
  });

  it('渲染描述与动作', () => {
    const html = renderToStaticMarkup(
      <Banner
        title="提醒"
        description="请补充资料"
        action={<button>去补</button>}
      />,
    );
    expect(html).toContain('请补充资料');
    expect(html).toContain('<button>去补</button>');
  });
});
