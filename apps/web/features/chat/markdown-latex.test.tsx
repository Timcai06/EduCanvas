import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('@/features/canvas/sandbox-preview', () => ({
  isPreviewableHtml: () => false,
}));

const { MessageMarkdown } = await import('./markdown');

function render(text: string) {
  return renderToStaticMarkup(createElement(MessageMarkdown, { text }));
}

describe('MessageMarkdown — LaTeX 数学公式', () => {
  it('行内公式 $E = mc^2$ 生成 KaTeX span', () => {
    const html = render('质能方程 $E = mc^2$ 是物理学基石。');
    expect(html).toContain('class="katex"');
    expect(html).toContain('E');
    expect(html).not.toContain('$E = mc$');
  });

  it('块级公式生成 katex-display 容器', () => {
    const html = render(
      '公式：\n\n$$\n\\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}\n$$\n\n结束',
    );
    expect(html).toContain('class="katex-display"');
    expect(html).toContain('katex');
  });

  it('行内代码 $x$ 不被当作公式', () => {
    const html = render('使用 `$x$` 表示变量。');
    expect(html).toContain('<code');
    expect(html).toContain('$x$');
    expect(html).not.toContain('katex');
  });

  it('fenced code block 中的 TeX 不执行', () => {
    const html = render('```\n$$\n\\frac{1}{2}\n$$\n```');
    expect(html).toContain('<code');
    expect(html).not.toContain('katex');
  });

  it('恶意原始 HTML 不渲染', () => {
    const html = render('<script>alert("xss")</script> 正常文本');
    expect(html).not.toContain('<script');
    expect(html).toContain('正常文本');
  });

  it('非法或不完整 TeX 不导致组件抛异常', () => {
    expect(() => render('$\\nonexistentcmd$')).not.toThrow();
    expect(() => render('$$\\frac$$')).not.toThrow();
    expect(() => render('$\\frac{1{}')).not.toThrow();
    const html = render('$\\nonexistentcmd$');
    expect(html).toContain('katex');
  });

  it('公式输出包含可访问的 MathML', () => {
    const html = render('$x^2$');
    expect(html).toContain('<math');
    expect(html).toContain('xmlns="http://www.w3.org/1998/Math/MathML"');
  });

  it('转义美元符号不被当作公式定界符', () => {
    const html = render('价格 \\$19.99 和 \\$12.50');
    expect(html).toContain('$19.99');
    expect(html).toContain('$12.50');
  });

  it('中文正文与公式混排', () => {
    const html = render('设 $a > 0$，则 $\\sqrt{a}$ 有意义。');
    expect(html).toContain('katex');
    expect(html).toContain('设');
    expect(html).toContain('则');
  });

  it('希腊字母公式渲染为 Unicode', () => {
    const html = render('$\\alpha + \\beta = \\gamma$');
    expect(html).toContain('katex');
    // KaTeX renders Greek letters as Unicode in visible HTML
    expect(html).toContain('\u03B1'); // α
    expect(html).toContain('\u03B2'); // β
    expect(html).toContain('\u03B3'); // γ
  });

  it('矩阵公式', () => {
    const html = render(
      '$$\n\\begin{pmatrix} 1 & 0 \\\\\\\\ 0 & 1 \\end{pmatrix}\n$$',
    );
    expect(html).toContain('katex-display');
    expect(html).toContain('katex');
  });

  it('上下标和根号', () => {
    const html = render('$x^{2} + \\sqrt{y}$');
    expect(html).toContain('katex');
    expect(html).not.toContain('$x^{2}');
  });
});
