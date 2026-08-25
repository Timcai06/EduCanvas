import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Tabs } from './tabs';

const items = [
  { id: 'overview', label: '概览', content: <p>概览面板</p> },
  { id: 'detail', label: '明细', content: <p>明细面板</p> },
];

describe('Tabs', () => {
  it('渲染 tablist/tab 与选中语义', () => {
    const html = renderToStaticMarkup(
      <Tabs items={items} value="overview" onChange={() => {}} />,
    );
    expect(html).toContain('role="tablist"');
    expect(html).toContain('role="tab"');
    expect(html).toContain('aria-selected="true"');
  });

  it('只渲染当前选中面板', () => {
    const html = renderToStaticMarkup(
      <Tabs items={items} value="detail" onChange={() => {}} />,
    );
    expect(html).toContain('明细面板');
    expect(html).not.toContain('概览面板');
  });

  it('选中 tab 用纸面浮起样式', () => {
    expect(
      renderToStaticMarkup(
        <Tabs items={items} value="overview" onChange={() => {}} />,
      ),
    ).toContain('bg-card text-ink shadow-[var(--shadow-float)]');
  });
});
