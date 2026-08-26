import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import ReactMarkdown from 'react-markdown';
import { MarkdownCalloutBlockquote } from './markdown-callout';
import { mathRemarkPlugins, mathRehypePlugins } from './math-markdown';

function render(markdown: string): string {
  return renderToStaticMarkup(
    <ReactMarkdown
      remarkPlugins={mathRemarkPlugins}
      rehypePlugins={mathRehypePlugins}
      components={{ blockquote: MarkdownCalloutBlockquote }}
    >
      {markdown}
    </ReactMarkdown>,
  );
}

describe('MarkdownCalloutBlockquote（经完整管线的静态契约）', () => {
  it('合法 callout 渲染类型徽标、标题与正文，标记行被消费', () => {
    const html = render('> [!note] 记住这一点\n> 正文内容');
    expect(html).toContain('data-callout="note"');
    expect(html).toContain('记住这一点');
    expect(html).toContain('正文内容');
    /* 标记本身不得出现在输出里 */
    expect(html).not.toContain('[!note]');
  });

  it('软换行正文（无空行的连续引用）保留为段落文本', () => {
    const html = render('> [!info] 标题\n> 第一段\n> 第二段');
    expect(html).toContain('第一段');
    expect(html).toContain('第二段');
    expect(html).not.toContain('[!info]');
  });

  it('折叠 - 默认收起正文但标题可见；+ 展开且可切换', () => {
    const folded = render('> [!tip]- 看不见的正文\n> 秘密');
    expect(folded).toContain('data-callout-fold="-"');
    expect(folded).toContain('看不见的正文');
    expect(folded).toContain('hidden');

    const unfolded = render('> [!tip]+ 可见的正文\n> 公开');
    expect(unfolded).toContain('data-callout-fold="+"');
    expect(unfolded).toContain('公开');
  });

  it('无标记引用块降级为带样式的普通 blockquote', () => {
    const html = render('> 普通引用');
    expect(html).toContain('<blockquote');
    expect(html).not.toContain('data-callout=');
  });

  it('未知类型降级 note 风格但保留原始类型名与默认标签兜底', () => {
    const html = render('> [!mystery]\n> 内容');
    expect(html).toContain('data-callout="mystery"');
    /* 无标题时回退类型名 */
    expect(html).toContain('mystery</span>');
  });

  it('安全回归：callout 内危险 href 与脚本转义仍然生效', () => {
    const html = render(
      '> [!info] 外部提示\n> [恶意链接](javascript:alert(1))\n> <script>alert(2)</script>',
    );
    expect(html).toContain('data-callout="info"');
    expect(html).not.toContain('href="javascript:');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
