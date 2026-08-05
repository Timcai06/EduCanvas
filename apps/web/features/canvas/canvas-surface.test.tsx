import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CanvasActionSurface, CanvasSurface } from './canvas-surface';

describe('CanvasSurface', () => {
  it('shares the same bounded surface language across static and interactive content', () => {
    const staticHtml = renderToStaticMarkup(
      <CanvasSurface>静态内容</CanvasSurface>,
    );
    const actionHtml = renderToStaticMarkup(
      <CanvasActionSurface>交互内容</CanvasActionSurface>,
    );

    for (const className of [
      'rounded-2xl',
      'border-line/70',
      'bg-surface/50',
    ]) {
      expect(staticHtml).toContain(className);
      expect(actionHtml).toContain(className);
    }
    expect(actionHtml).toContain('<button');
    expect(actionHtml).toContain('type="button"');
  });
});
