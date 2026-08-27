import { describe, expect, it } from 'vitest';
import {
  dedupeSlug,
  pickActiveHeading,
  slugifyHeading,
} from './markdown-toc-model';

describe('slugifyHeading', () => {
  it('保留 CJK 与字母数字，空白折叠为连字符', () => {
    expect(slugifyHeading('  TCP 协议 三次握手 ')).toBe('tcp-协议-三次握手');
    expect(slugifyHeading('What is RAG?')).toBe('what-is-rag');
  });

  it('剥离标点与 emoji 等符号字符', () => {
    expect(slugifyHeading('第 1 章：导论！')).toBe('第-1-章导论');
    expect(slugifyHeading('A/B 测试 🚀')).toBe('ab-测试');
  });
});

describe('dedupeSlug', () => {
  it('首次出现原样，之后追加计数后缀', () => {
    const used = new Map<string, number>();
    expect(dedupeSlug('导论', used)).toBe('导论');
    expect(dedupeSlug('导论', used)).toBe('导论-2');
    expect(dedupeSlug('导论', used)).toBe('导论-3');
    /* 不同标题互不影响 */
    expect(dedupeSlug('方法', used)).toBe('方法');
  });

  it('空 slug（纯符号标题）由调用方兜底，这里只保证不抛错', () => {
    const used = new Map<string, number>();
    expect(dedupeSlug('', used)).toBe('');
    expect(dedupeSlug('', used)).toBe('-2');
  });
});

describe('pickActiveHeading', () => {
  const tops = [0, 400, 800, 1200];

  it('尚未滚过第一个标题时高亮第一章', () => {
    expect(pickActiveHeading(tops, 0)).toBe(0);
  });

  it('滚过某章节标题后，当前章节是「最后一个已越过的」', () => {
    /* scrollTop=500：第 3 章(800)未到顶，第 2 章(400)已越过 */
    expect(pickActiveHeading(tops, 500)).toBe(1);
    expect(pickActiveHeading(tops, 810, 10)).toBe(2);
  });

  it('全部越过后停在最后一章；空列表返回 -1', () => {
    expect(pickActiveHeading(tops, 9999)).toBe(3);
    expect(pickActiveHeading([], 100)).toBe(-1);
  });
});
