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
 * 标题/链接/图片/列表等不被误删），仅补充表格展示属性，并显式整体剥离
 * 脚本、样式、iframe、表单与媒体标签。sanitize 作用于整棵渲染树，因此
 * 不能自建最小 tagNames——那会连 markdown 语法生成的元素一起删除。
 * 仅结构化阅读视图经 structuredReadingRehypePlugins 使用；聊天与笔记
 * 渲染维持不渲染 raw HTML 的既有边界。
 */
export const tableAllowlistSchema: Schema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), 'caption', 'colgroup', 'col'],
  attributes: {
    ...(defaultSchema.attributes ?? {}),
    // 属性名遵循 hast camelCase（colspan → colSpan），与 rehype-sanitize 匹配
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
  },
  // 整体剥离（含内容），不留 unwrap 文本：样式、iframe、交互表单与媒体
  // 一律不放行。input 不在其中——GFM 任务列表的 disabled checkbox 是
  // markdown 语法生成的合法元素，defaultSchema 已将其属性限制为
  // type=checkbox + disabled。
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
