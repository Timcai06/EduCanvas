import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import type { Schema } from 'hast-util-sanitize';

/**
 * 统一的数学 Markdown 插件配置。MessageMarkdown 与 NoteRenderer 共用，
 * 禁止在各组件内重复声明插件数组。
 *
 * 安全边界：默认不引入 rehype-raw；TeX 错误由 rehype-katex 的 throwOnError: false
 * 兜底，不会导致整条消息或 Canvas 崩溃。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- unified plugin 类型由 react-markdown 内部约束
export const mathRemarkPlugins: any[] = [remarkGfm, remarkMath];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const mathRehypePlugins: any[] = [
  [rehypeKatex, { throwOnError: false }],
];

/**
 * ADR-0030 白名单：只放行表格系列与表格内基础排版，禁 script/style/iframe/
 * 事件属性与任意 URL 协议。仅结构化阅读视图经 structuredReadingRehypePlugins
 * 使用；聊天与笔记渲染维持不渲染 raw HTML 的既有边界。
 */
export const tableAllowlistSchema: Schema = {
  tagNames: [
    'table',
    'thead',
    'tbody',
    'tfoot',
    'tr',
    'th',
    'td',
    'caption',
    'colgroup',
    'col',
    'p',
    'br',
    'strong',
    'em',
    'b',
    'i',
    'u',
    's',
    'del',
    'ins',
    'sub',
    'sup',
    'span',
    'ul',
    'ol',
    'li',
  ],
  attributes: {
    // 属性名遵循 hast camelCase（colspan → colSpan），与 rehype-sanitize 匹配
    table: [
      'align',
      'border',
      'cellPadding',
      'cellSpacing',
      'width',
      'summary',
    ],
    th: ['align', 'colSpan', 'rowSpan', 'scope', 'valign', 'width'],
    td: ['align', 'colSpan', 'rowSpan', 'valign', 'width'],
    col: ['align', 'span', 'width'],
    colgroup: ['align', 'span', 'width'],
  },
  // 不放行任何 URL 协议；on* 事件属性不在 attributes 白名单内即被剥离。
  protocols: {},
  // 整体剥离（含内容），不留 unwrap 文本：脚本、样式、交互与媒体一律不放行。
  strip: [
    'script',
    'style',
    'iframe',
    'object',
    'embed',
    'form',
    'input',
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
