import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Progress } from './progress';

describe('Progress', () => {
  it('默认 role=progressbar 并暴露数值', () => {
    const html = renderToStaticMarkup(<Progress value={40} label="已学进度" />);
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuenow="40"');
    expect(html).toContain('aria-label="已学进度"');
  });

  it('宽度按百分比写入内联样式', () => {
    expect(renderToStaticMarkup(<Progress value={75} />)).toContain(
      'width:75%',
    );
  });

  it('越界值钳制到 0..100', () => {
    expect(renderToStaticMarkup(<Progress value={120} />)).toContain(
      'width:100%',
    );
    expect(renderToStaticMarkup(<Progress value={-5} />)).toContain('width:0%');
  });
});
