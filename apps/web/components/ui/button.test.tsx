import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Button } from './button';

describe('Button', () => {
  it('primary 默认用墨紫主讲色', () => {
    const html = renderToStaticMarkup(<Button>打开</Button>);
    expect(html).toContain('bg-accent');
    expect(html).toContain('text-card');
  });

  it('secondary/ghost/danger 各有语义类', () => {
    expect(
      renderToStaticMarkup(<Button variant="secondary">次</Button>),
    ).toContain('border-line');
    expect(
      renderToStaticMarkup(<Button variant="danger">删</Button>),
    ).toContain('bg-cinnabar');
    expect(renderToStaticMarkup(<Button variant="ghost">隐</Button>)).toContain(
      'hover:bg-surface',
    );
  });

  it('disabled 透传 disabled', () => {
    expect(renderToStaticMarkup(<Button disabled>提交</Button>)).toContain(
      'disabled=""',
    );
  });

  it('loading 前置 spinner 并禁用', () => {
    const html = renderToStaticMarkup(<Button loading>保存</Button>);
    expect(html).toContain('disabled=""');
    expect(html).toContain('animate-spin');
  });
});
