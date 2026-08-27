import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CanvasProgressBar } from './canvas-progress-bar';

describe('CanvasProgressBar', () => {
  it('只读进度使用 progressbar 语义且不进入 tab 顺序', () => {
    const html = renderToStaticMarkup(
      <CanvasProgressBar value={0.25} label="阅读进度" />,
    );

    expect(html).toContain('role="progressbar"');
    expect(html).not.toContain('tabindex=');
  });

  it('可跳转进度使用可聚焦 slider 语义', () => {
    const html = renderToStaticMarkup(
      <CanvasProgressBar value={0.5} label="幻灯片进度" onSeek={() => {}} />,
    );

    expect(html).toContain('role="slider"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('aria-valuenow="50"');
  });
});
