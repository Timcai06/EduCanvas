/**
 * Callout 的 mdast 前置转换（Issue #477 采用的 remark 插件路线）。
 *
 * 为什么必须在 mdast 层做：Obsidian 标记行常与正文同处一个段落（软换行），
 * 渲染层拿到的是已完成的 React 子树，无法事后剥离标记文本；只有渲染前
 * 改写树，标记行才会真正从输出中消失。
 *
 * 转换内容：识别 blockquote 首段首文本的 `[!type](+/-)? 标题?`，把类型/
 * 折叠/标题写入 data.hProperties（随管线落到 DOM data-* 属性），并从段落
 * 中消费掉标记行。畸形标记一律不动，自然降级为普通引用块。
 *
 * 安全边界：写入的是静态字符串属性，不产生任何 raw HTML；子树其余部分
 * 照常经过既有转义与链接剥离。
 */

/** 与 Obsidian 兼容的别名收敛，避免渲染层枚举爆炸。 */
const TYPE_ALIASES: Record<string, string> = {
  abstract: 'info',
  summary: 'info',
  tldr: 'info',
  todo: 'todo',
  hint: 'tip',
  important: 'tip',
  check: 'success',
  done: 'success',
  help: 'question',
  faq: 'question',
  caution: 'warning',
  attention: 'warning',
  fail: 'failure',
  missing: 'failure',
  cite: 'quote',
};

/* 只解析标记所在的首行；软换行正文单独保留（. 不跨行，$ 不容错换行） */
const MARKER_LINE_RE = /^[ \t]*\[!([a-zA-Z]+)\]([+-])?[ \t]*(.*)$/;

export interface ParsedCalloutMarker {
  type: string;
  fold: '+' | '-' | null;
  title: string;
  /** 标记行之后的软换行正文，需保留在原段落里。 */
  restLines: string;
}

export function parseCalloutMarker(text: string): ParsedCalloutMarker | null {
  const newlineIndex = text.indexOf('\n');
  const firstLine =
    newlineIndex === -1 ? text : text.slice(0, newlineIndex);
  const restLines = newlineIndex === -1 ? '' : text.slice(newlineIndex + 1);
  const match = MARKER_LINE_RE.exec(firstLine);
  if (!match) return null;
  const rawType = match[1]!.toLowerCase();
  const canonical = TYPE_ALIASES[rawType] ?? rawType;
  return {
    type: canonical,
    fold: match[2] === undefined ? null : (match[2] as '+' | '-'),
    title: match[3]!.trim(),
    restLines,
  };
}

/* 最小结构类型：避免为一个小插件引入完整 mdast 类型依赖 */
interface MdNode {
  type: string;
  children?: MdNode[];
  value?: string;
  data?: { hProperties?: Record<string, unknown> };
}

export function remarkCallout() {
  return (tree: MdNode): void => {
    const walk = (node: MdNode): void => {
      if (!node.children) return;
      for (const child of node.children) walk(child);

      if (node.type !== 'blockquote') return;
      const paragraphChildren = node.children[0]?.children;
      const paragraph = node.children[0];
      if (!paragraph || paragraph.type !== 'paragraph') return;
      if (!paragraphChildren || paragraphChildren.length === 0) return;
      const text = paragraphChildren[0];
      if (!text || text.type !== 'text' || typeof text.value !== 'string') {
        return;
      }
      const marker = parseCalloutMarker(text.value);
      if (!marker) return;

      const data = (node.data ??= {});
      const props: Record<string, unknown> = { ...data.hProperties };
      props['data-callout'] = marker.type;
      if (marker.fold) props['data-callout-fold'] = marker.fold;
      if (marker.title) props['data-callout-title'] = marker.title;
      data.hProperties = props;

      /* 消费标记行：同段还有后续行则改写文本，否则移除空段 */
      if (marker.restLines) {
        text.value = marker.restLines;
      } else {
        paragraphChildren.shift();
        const isEmpty =
          paragraphChildren.length === 0 ||
          paragraphChildren.every(
            (item) =>
              item.type === 'text' && (item.value ?? '').trim() === '',
          );
        if (isEmpty) node.children.shift();
      }
    };
    walk(tree);
  };
}
