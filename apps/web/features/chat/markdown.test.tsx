import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MessageMarkdown } from './markdown';

const TABLE_HTML =
  '<table><tr><td colspan="3"><p><strong>序号：1</strong></p></td></tr></table>';

describe('MessageMarkdown 受控表格 HTML（ADR-0030）', () => {
  it('allowRawHtml 时保留表格标签与 colspan 属性', () => {
    const html = renderToStaticMarkup(
      <MessageMarkdown text={TABLE_HTML} allowRawHtml />,
    );
    expect(html).toContain('<table>');
    expect(html).toContain('colSpan="3"');
    expect(html).toContain('序号：1');
  });

  it('脚本、iframe、事件属性与 style 整体剥离', () => {
    const malicious =
      '<script>alert(1)</script><iframe src="https://evil.example"></iframe>' +
      '<table><tr><td onclick="alert(2)" style="color:red">x</td></tr></table>';
    const html = renderToStaticMarkup(
      <MessageMarkdown text={malicious} allowRawHtml />,
    );
    expect(html).not.toContain('script');
    expect(html).not.toContain('iframe');
    expect(html).not.toContain('onclick');
    expect(html).not.toContain('style=');
    expect(html).not.toContain('alert');
  });

  it('markdown 语法元素（标题/任务列表/链接）不被 sanitize 误删', () => {
    const md = '# 网络编程讲义\n\n- [x] 已完成\n\n[链接](https://example.com)';
    const html = renderToStaticMarkup(
      <MessageMarkdown text={md} allowRawHtml />,
    );
    expect(html).toContain('<h1>网络编程讲义</h1>');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('href="https://example.com"');
  });

  it('默认路径（allowRawHtml 缺省）仍不渲染 raw HTML', () => {
    const html = renderToStaticMarkup(<MessageMarkdown text={TABLE_HTML} />);
    // raw HTML 只以转义文本出现，绝不生成真实 <table> 元素
    expect(html).not.toContain('<table>');
    expect(html).not.toContain('<td');
    expect(html).toContain('&lt;table&gt;');
  });
});
