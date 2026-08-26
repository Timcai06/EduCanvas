const CALLOUT_MARKER =
  /^\[!(note|info|tip|success|question|warning|danger|example)\]([+-])?(?:[ \t]+([^\n]*))?(?:\n|$)/i;

interface MarkdownNode {
  type: string;
  value?: string;
  children?: MarkdownNode[];
  data?: {
    hName?: string;
    hProperties?: Record<string, unknown>;
  };
}

const CALLOUT_PRESENTATION: Record<string, { label: string; symbol: string }> =
  {
    note: { label: '笔记', symbol: '✎' },
    info: { label: '信息', symbol: 'i' },
    tip: { label: '提示', symbol: '◇' },
    success: { label: '完成', symbol: '✓' },
    question: { label: '问题', symbol: '?' },
    warning: { label: '注意', symbol: '!' },
    danger: { label: '危险', symbol: '×' },
    example: { label: '示例', symbol: '≡' },
  };

/**
 * 将白名单内的 Obsidian callout 标记附着到原 blockquote。
 * 未知或畸形标记保持原树不变，因此会自然降级为普通引用。
 */
export function remarkCallout() {
  return (tree: MarkdownNode) => {
    visit(tree);
  };
}

function visit(node: MarkdownNode): void {
  if (node.type === 'blockquote') markCallout(node);
  node.children?.forEach(visit);
}

function markCallout(blockquote: MarkdownNode): void {
  blockquote.data = {
    ...blockquote.data,
    hProperties: {
      ...blockquote.data?.hProperties,
      dataMarkdownQuote: 'true',
    },
  };
  const paragraph = blockquote.children?.[0];
  const firstText =
    paragraph?.type === 'paragraph' ? paragraph.children?.[0] : null;
  if (firstText?.type !== 'text' || typeof firstText.value !== 'string') return;

  const match = CALLOUT_MARKER.exec(firstText.value);
  if (!match) return;

  const [, rawType, fold = '', rawTitle = ''] = match;
  const type = rawType!.toLowerCase();
  const presentation = CALLOUT_PRESENTATION[type]!;
  const title = rawTitle.trim() || presentation.label;
  firstText.value = firstText.value.slice(match[0].length);
  paragraph!.children = paragraph!.children?.filter(
    (child) => child.type !== 'text' || child.value !== '',
  );
  if (paragraph!.children?.length === 0) blockquote.children?.shift();

  const header: MarkdownNode = {
    type: 'paragraph',
    children: [{ type: 'text', value: `${presentation.symbol} ${title}` }],
    data: {
      hName: fold ? 'summary' : 'div',
      hProperties: { dataCalloutHeader: 'true' },
    },
  };
  blockquote.children?.unshift(header);
  blockquote.data = {
    hName: fold ? 'details' : 'aside',
    hProperties: {
      dataCallout: type,
      dataCalloutFold: fold,
      ...(fold === '+' ? { open: true } : {}),
      ...(!fold ? { ariaLabel: `${presentation.label}：${title}` } : {}),
    },
  };
}
