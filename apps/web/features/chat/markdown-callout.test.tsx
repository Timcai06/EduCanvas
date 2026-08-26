import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MessageMarkdown } from './markdown';

const render = (text: string, allowRawHtml = false) =>
  renderToStaticMarkup(
    <MessageMarkdown text={text} allowRawHtml={allowRawHtml} />,
  );

describe('Markdown callout', () => {
  it.each([
    ['note', '笔记'],
    ['info', '信息'],
    ['tip', '提示'],
    ['success', '完成'],
    ['question', '问题'],
    ['warning', '注意'],
    ['danger', '危险'],
    ['example', '示例'],
  ])('渲染白名单类型 %s', (type, defaultLabel) => {
    const html = render(`> [!${type}]\n> 正文`);
    expect(html).toContain('<aside');
    expect(html).toContain(defaultLabel);
    expect(html).toContain('正文');
    expect(html).not.toContain(`[!${type}]`);
  });

  it('保留自定义标题、嵌套列表、GFM 与数学公式', () => {
    const html = render('> [!tip] 解题提示\n> - [x] 配方\n> - 使用 $b^2-4ac$');
    expect(html).toContain('解题提示');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('katex');
  });

  it('使用原生 details 表达展开与收起状态', () => {
    expect(render('> [!note]+ 展开\n> 内容')).toContain('<details');
    expect(render('> [!note]+ 展开\n> 内容')).toContain('open=""');
    const collapsed = render('> [!warning]- 收起\n> 内容');
    expect(collapsed).toContain('<details');
    expect(collapsed).not.toContain('open=""');
  });

  it('未知或畸形标记优雅降级为有样式的普通引用', () => {
    for (const text of ['> [!unknown] 标题', '> [!note 标题', '> 普通引用']) {
      const html = render(text);
      expect(html).toContain('<blockquote');
      expect(html).not.toContain('<aside');
    }
  });

  it('callout 内仍不执行 raw HTML 或危险链接', () => {
    const html = render(
      '> [!danger] 不可信内容\n> [链接](javascript:alert(1))\n> <script>alert(2)</script>',
    );
    expect(html).toContain('不可信内容');
    expect(html).not.toContain('href="javascript:');
    expect(html).not.toContain('<script');
    expect(html).toContain('&lt;script&gt;');
  });

  it('结构化阅读 sanitize 路径保留受控 callout 属性', () => {
    const html = render('> [!info] 来源说明\n> 正文', true);
    expect(html).toContain('<aside');
    expect(html).toContain('来源说明');
  });
});
