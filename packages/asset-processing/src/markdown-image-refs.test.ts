import { describe, expect, it } from 'vitest';
import { rewriteMarkdownImageRefs } from './markdown-image-refs';

describe('rewriteMarkdownImageRefs', () => {
  it('把 images/ 相对引用重写为鉴权 URL', () => {
    const md = '正文\n\n![叶绿体](images/001.jpg)\n\n结尾。';

    const out = rewriteMarkdownImageRefs(md, (p) => `/r/${p}`);

    expect(out).toBe('正文\n\n![叶绿体](/r/images/001.jpg)\n\n结尾。');
  });

  it('带 title 的引用保留 title 只重写路径', () => {
    const md = '![图](images/002.png "标题")';

    expect(rewriteMarkdownImageRefs(md, (p) => `/r/${p}`)).toBe(
      '![图](/r/images/002.png "标题")',
    );
  });

  it('多个引用全部重写', () => {
    const md = '![a](images/a.jpg) ![b](images/b.png)';

    expect(rewriteMarkdownImageRefs(md, (p) => `/r/${p}`)).toBe(
      '![a](/r/images/a.jpg) ![b](/r/images/b.png)',
    );
  });

  it('外部 http(s) URL 不重写（不把外部内容当派生资源）', () => {
    const md = '![网图](https://example.com/a.png) ![本地](images/x.jpg)';

    expect(rewriteMarkdownImageRefs(md, (p) => `/r/${p}`)).toBe(
      '![网图](https://example.com/a.png) ![本地](/r/images/x.jpg)',
    );
  });

  it('非 images/ 的相对路径保留原样', () => {
    const md = '![a](./a.png) ![b](a.png) ![c](../x.gif)';

    expect(rewriteMarkdownImageRefs(md, () => '/r/x')).toBe(md);
  });

  it('resolver 返回 null（资源不存在）时保留原样，不制造悬空链接', () => {
    const md = '![缺图](images/gone.jpg)';

    expect(rewriteMarkdownImageRefs(md, () => null)).toBe(md);
  });

  it('普通链接不是图片引用，不重写', () => {
    const md = '[文档](images/doc.pdf)';

    expect(rewriteMarkdownImageRefs(md, () => '/r/x')).toBe(md);
  });

  it('fenced code block 内的图片引用不误伤（不可信输入防御）', () => {
    const md = '```md\n![](images/code.jpg)\n```\n\n![](images/real.jpg)';

    expect(rewriteMarkdownImageRefs(md, (p) => `/r/${p}`)).toBe(
      '```md\n![](images/code.jpg)\n```\n\n![](images/real.jpg)'.replace(
        '![](images/real.jpg)',
        '![](/r/images/real.jpg)',
      ),
    );
  });

  it('无图片引用时原样返回', () => {
    const md = '# 标题\n\n纯文本段落。';

    expect(rewriteMarkdownImageRefs(md, () => '/r/x')).toBe(md);
  });

  it('data URI 保留原样', () => {
    const md = '![内联](data:image/png;base64,AAAA)';

    expect(rewriteMarkdownImageRefs(md, () => '/r/x')).toBe(md);
  });

  it('空 md 返回空串', () => {
    expect(rewriteMarkdownImageRefs('', () => '/r/x')).toBe('');
  });
});
