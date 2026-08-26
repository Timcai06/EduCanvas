import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import type { Schema } from 'hast-util-sanitize';
import { remarkCallout } from './remark-callout';

/**
 * 统一的数学 Markdown 插件配置。MessageMarkdown 与 NoteRenderer 共用，
 * 禁止在各组件内重复声明插件数组。
 *
 * 安全边界：默认不引入 rehype-raw；TeX 错误由 rehype-katex 的 throwOnError: false
 * 兜底，不会导致整条消息或 Canvas 崩溃。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- unified plugin 类型由 react-markdown 内部约束
export const mathRemarkPlugins: any[] = [remarkGfm, remarkMath, remarkCallout];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const mathRehypePlugins: any[] = [
  [rehypeKatex, { throwOnError: false }],
];

/**
 * ADR-0030 白名单：以 GitHub 默认 schema 为基底（保 markdown 原生元素：
 * 标题/链接/图片/列表等不被误删），仅补充表格展示属性与安全的 Callout
 * 结构，并显式整体剥离脚本、样式、iframe、表单与媒体标签。
 */
export const tableAllowlistSchema: Schema = {
  ...defaultSchema,
  tagNames: [
    ...(defaultSchema.tagNames ?? []),
    'caption',
    'colgroup',
    'col',
    'aside',
    'details',
    'summary',
  ],
  attributes: {
    ...(defaultSchema.attributes ?? {}),
    table: [
      ...((defaultSchema.attributes ?? {}).table ?? []),
      'align',
      'border',
      'cellPadding',
      'cellSpacing',
      'width',
      'summary',
    ],
    th: [
      ...((defaultSchema.attributes ?? {}).th ?? []),
      'align',
      'colSpan',
      'rowSpan',
      'scope',
      'valign',
      'width',
    ],
    td: [
      ...((defaultSchema.attributes ?? {}).td ?? []),
      'align',
      'colSpan',
      'rowSpan',
      'valign',
      'width',
    ],
    col: ['align', 'span', 'width'],
    colgroup: ['align', 'span', 'width'],
    blockquote: [
      ...((defaultSchema.attributes ?? {}).blockquote ?? []),
      'dataMarkdownQuote',
    ],
    aside: ['ariaLabel', 'dataCallout', 'dataCalloutFold'],
    details: ['dataCallout', 'dataCalloutFold', 'open'],
    summary: ['dataCalloutHeader'],
    div: [...((defaultSchema.attributes ?? {}).div ?? []), 'dataCalloutHeader'],
  },
  strip: [
    ...(defaultSchema.strip ?? []),
    'style',
    'iframe',
    'object',
    'embed',
    'form',
    'button',
    'textarea',
    'select',
    'video',
    'audio',
    'canvas',
    'svg',
    'math',
  ],
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- unified plugin 类型由 react-markdown 内部约束
export const structuredReadingRehypePlugins: any[] = [
  [rehypeKatex, { throwOnError: false }],
  rehypeRaw,
  [rehypeSanitize, tableAllowlistSchema],
];
