import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Badge } from './badge';

describe('Badge', () => {
  it('默认 neutral 用纸面/淡墨', () => {
    const html = renderToStaticMarkup(<Badge>可用</Badge>);
    expect(html).toContain('bg-surface');
    expect(html).toContain('text-ink-muted');
  });

  it('accent/cinnabar/good/warn/bad 各有语义色', () => {
    expect(
      renderToStaticMarkup(<Badge variant="accent">优势</Badge>),
    ).toContain('bg-accent-soft');
    expect(
      renderToStaticMarkup(<Badge variant="cinnabar">重点</Badge>),
    ).toContain('bg-cinnabar-soft');
    expect(
      renderToStaticMarkup(<Badge variant="good">已通过</Badge>),
    ).toContain('bg-good-soft');
    expect(
      renderToStaticMarkup(<Badge variant="warn">待处理</Badge>),
    ).toContain('bg-warn-soft');
    expect(renderToStaticMarkup(<Badge variant="bad">失败</Badge>)).toContain(
      'bg-bad-soft',
    );
  });
});
