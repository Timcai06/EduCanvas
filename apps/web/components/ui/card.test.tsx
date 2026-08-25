import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Card } from './card';

describe('Card', () => {
  it('默认表面：圆角 + 边界 + 墨色投影', () => {
    const html = renderToStaticMarkup(<Card>内容</Card>);
    expect(html).toContain('rounded-2xl');
    expect(html).toContain('border-line/70');
    expect(html).toContain('shadow-[var(--shadow-float)]');
  });

  it('hover 打开抬升与投影加深', () => {
    expect(renderToStaticMarkup(<Card hover>内容</Card>)).toContain(
      'hover:-translate-y-0.5',
    );
  });

  it('glass 启用磨砂玻璃类', () => {
    expect(renderToStaticMarkup(<Card glass>内容</Card>)).toContain('glass');
  });
});
