import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

/**
 * 统一的数学 Markdown 插件配置。MessageMarkdown 与 NoteRenderer 共用，
 * 禁止在各组件内重复声明插件数组。
 *
 * 安全边界：不引入 rehype-raw；TeX 错误由 rehype-katex 的 throwOnError: false
 * 兜底，不会导致整条消息或 Canvas 崩溃。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- unified plugin 类型由 react-markdown 内部约束
export const mathRemarkPlugins: any[] = [remarkGfm, remarkMath];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const mathRehypePlugins: any[] = [
  [rehypeKatex, { throwOnError: false }],
];
