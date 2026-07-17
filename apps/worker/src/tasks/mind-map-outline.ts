import {
  MIND_MAP_CONTENT_VERSION,
  mindMapContentSchema,
  type MindMapContent,
  type MindMapNode,
} from '@educanvas/canvas-protocol';

export interface OutlineSourceMessage {
  role: 'user' | 'assistant';
  content: string;
}

const MAX_BRANCHES = 10;
const MAX_LABEL = 80;

const toLabel = (text: string): string => {
  const firstLine = text.trim().split('\n')[0] ?? '';
  const plain = firstLine.replace(/^[#>\-*\s]+/, '').trim();
  const label = plain.length > 0 ? plain : '(空内容)';
  return label.length > MAX_LABEL ? `${label.slice(0, MAX_LABEL - 1)}…` : label;
};

/**
 * v1 思维导图为**规则生成的对话大纲**:根=标题,一级=学生问题,二级=对应回答
 * 的首行与二级标题。这是产物管线的确定性占位实现——它诚实地是"大纲"而不是
 * AI 摘要;模型驱动的导图生成在 M2 接入 generateStructured 后替换本函数,
 * 管线其余部分(任务/版本/事件)不变。
 */
export function buildConversationOutline(
  title: string,
  messages: readonly OutlineSourceMessage[],
): MindMapContent {
  const branches: MindMapNode[] = [];
  let sequence = 0;
  for (const message of messages) {
    if (branches.length >= MAX_BRANCHES) break;
    if (message.role !== 'user') continue;
    sequence += 1;
    const node: MindMapNode = {
      id: `q${sequence}`,
      label: toLabel(message.content),
    };
    const answer = messages[messages.indexOf(message) + 1];
    if (answer && answer.role === 'assistant') {
      const headings = answer.content
        .split('\n')
        .filter((line) => /^#{1,4}\s+\S/.test(line.trim()))
        .slice(0, 6);
      const children: MindMapNode[] = [
        { id: `q${sequence}-a`, label: toLabel(answer.content) },
        ...headings.map((heading, index) => ({
          id: `q${sequence}-h${index + 1}`,
          label: toLabel(heading),
        })),
      ];
      node.children = children;
    }
    branches.push(node);
  }

  const content: MindMapContent = {
    contentVersion: MIND_MAP_CONTENT_VERSION,
    root: {
      id: 'root',
      label: toLabel(title),
      ...(branches.length > 0 ? { children: branches } : {}),
    },
  };
  /* 出口自校验:生成器自己的产物必须过公开 Schema,坏结构在 worker 内失败。 */
  return mindMapContentSchema.parse(content);
}
