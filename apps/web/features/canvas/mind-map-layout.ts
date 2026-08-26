import type { MindMapContent } from '@educanvas/canvas-protocol';
import type {
  MindMapContentV1,
  MindMapContentV2,
} from '@educanvas/canvas-protocol';

type MindMapContentNode = MindMapContentV1['root'] & {
  children?: MindMapContentV1['root']['children'];
};

const VERTICAL_GAP = 82;
const HORIZONTAL_GAP = 248;
export const MIND_MAP_NODE_WIDTH = 188;
export const MIND_MAP_NODE_HEIGHT = 52;
const DEFAULT_PADDING = 56;

/** 分支五色 token（globals.css --color-branch-1..5）：L1 取模分配、子树继承。 */
export const MIND_MAP_BRANCH_COLOR_VARS = [
  'var(--color-branch-1)',
  'var(--color-branch-2)',
  'var(--color-branch-3)',
  'var(--color-branch-4)',
  'var(--color-branch-5)',
] as const;

type ParsedNode = {
  id: string;
  label: string;
  semanticRole?: string;
};

type ParsedGraph = {
  rootId: string;
  nodes: Record<string, ParsedNode>;
  outgoing: Record<string, string[]>;
  parent: Record<string, string | undefined>;
  connections: Array<{ from: string; to: string; semanticRole?: string }>;
};

export type MindMapViewNode = {
  id: string;
  label: string;
  depth: number;
  semanticRole?: string;
  x: number;
  y: number;
  children: string[];
  hasChildren: boolean;
  parentId?: string;
  /** 一级分支取模分配、子树继承的分支色（CSS 变量）；root 为 undefined。 */
  branchColorVar?: string;
  /** 主树后代总数（不受折叠影响）：折叠角标提示「点开有多大」。 */
  descendantCount: number;
};

export type MindMapViewEdge = {
  from: string;
  to: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  semanticRole?: string;
};

export type MindMapLayout = {
  rootId: string;
  nodes: MindMapViewNode[];
  edges: MindMapViewEdge[];
  visibleNodeIds: string[];
  width: number;
  height: number;
};

export type MindMapKeyDirection = 'up' | 'down' | 'left' | 'right' | 'toggle';

function isV2(content: MindMapContent): content is MindMapContentV2 {
  return content.contentVersion === 2;
}

function normalizeV1(root: MindMapContentNode): ParsedGraph {
  const nodes: Record<string, ParsedNode> = {};
  const outgoing: Record<string, string[]> = {};
  const parent: Record<string, string | undefined> = {};

  const walk = (node: MindMapContentNode, parentId?: string) => {
    nodes[node.id] = { id: node.id, label: node.label };
    if (parentId !== undefined) {
      parent[node.id] = parentId;
      outgoing[parentId] = [...(outgoing[parentId] ?? []), node.id];
    }
    for (const child of node.children ?? []) {
      walk(child, node.id);
    }
  };

  walk(root);
  return {
    rootId: root.id,
    nodes,
    outgoing,
    parent,
    connections: Object.entries(outgoing).flatMap(([from, children]) =>
      children.map((to) => ({ from, to, semanticRole: 'hierarchy' })),
    ),
  };
}

function normalizeV2(content: MindMapContentV2): ParsedGraph {
  const nodes = Object.fromEntries(
    content.nodes.map((node) => [
      node.id,
      { id: node.id, label: node.label, semanticRole: node.semanticRole },
    ]),
  ) as Record<string, ParsedNode>;
  const outgoing: Record<string, string[]> = {};
  const parent: Record<string, string | undefined> = {};

  for (const edge of content.edges) {
    if (edge.semanticRole === undefined || edge.semanticRole === 'hierarchy') {
      outgoing[edge.from] = [...(outgoing[edge.from] ?? []), edge.to];
      if (parent[edge.to] === undefined) parent[edge.to] = edge.from;
    }
  }
  return {
    rootId: content.rootNodeId,
    nodes,
    outgoing,
    parent,
    connections: content.edges,
  };
}

function buildVisibleState(
  parsed: ParsedGraph,
  collapsedNodeIds: ReadonlySet<string>,
): Array<{ id: string; depth: number }> {
  const visited = new Set<string>();
  const visible: Array<{ id: string; depth: number }> = [];
  const visit = (id: string, depth: number) => {
    if (visited.has(id)) return;
    visited.add(id);
    visible.push({ id, depth });
    if (collapsedNodeIds.has(id)) return;
    for (const child of parsed.outgoing[id] ?? []) {
      /* v2 允许关联边；布局树只采用节点首次确定的父级，额外边仍会绘制。 */
      if (parsed.parent[child] === id) visit(child, depth + 1);
    }
  };
  visit(parsed.rootId, 0);

  return visible;
}

function buildLayoutFromVisible(
  parsed: ParsedGraph,
  visible: Array<{ id: string; depth: number }>,
  collapsedNodeIds: ReadonlySet<string>,
): MindMapLayout {
  const visibleSet = new Set(visible.map((item) => String(item.id)));
  const primaryChildren = (nodeId: string) =>
    (parsed.outgoing[nodeId] ?? []).filter(
      (childId) => visibleSet.has(childId) && parsed.parent[childId] === nodeId,
    );

  /* 分支色：一级子节点按出现顺序取模取色，后代继承父级色（mind-elixir 模式）。
     用主树父级关系遍历，非 hierarchy 关联边不参与配色。 */
  const branchColorById = new Map<string, string>();
  const assignBranchColors = (nodeId: string, colorVar?: string) => {
    if (colorVar) branchColorById.set(nodeId, colorVar);
    let childSlot = 0;
    for (const childId of parsed.outgoing[nodeId] ?? []) {
      if (parsed.parent[childId] !== nodeId) continue;
      assignBranchColors(
        childId,
        nodeId === parsed.rootId
          ? MIND_MAP_BRANCH_COLOR_VARS[
              childSlot % MIND_MAP_BRANCH_COLOR_VARS.length
            ]
          : colorVar,
      );
      childSlot += 1;
    }
  };
  assignBranchColors(parsed.rootId);

  /* 后代计数与折叠无关：折叠角标要回答「点开有多大」，必须算全量主树。 */
  const descendantCountById = new Map<string, number>();
  const countDescendants = (nodeId: string): number => {
    let total = 0;
    for (const childId of parsed.outgoing[nodeId] ?? []) {
      if (parsed.parent[childId] !== nodeId) continue;
      total += 1 + countDescendants(childId);
    }
    descendantCountById.set(nodeId, total);
    return total;
  };
  countDescendants(parsed.rootId);

  const yById = new Map<string, number>();
  let nextLeaf = 0;
  const place = (nodeId: string): number => {
    const children = primaryChildren(nodeId);
    if (children.length === 0) {
      const y = DEFAULT_PADDING + nextLeaf * VERTICAL_GAP;
      nextLeaf += 1;
      yById.set(nodeId, y);
      return y;
    }
    const childY = children.map(place);
    const y = (childY[0]! + childY.at(-1)!) / 2;
    yById.set(nodeId, y);
    return y;
  };
  place(parsed.rootId);

  const visibleNodes: MindMapViewNode[] = visible.flatMap(({ id, depth }) => {
    const source = parsed.nodes[id];
    if (!source) return [];
    const allChildren = parsed.outgoing[id] ?? [];
    return [
      {
        id: id,
        label: source.label,
        depth,
        semanticRole: source.semanticRole,
        x: DEFAULT_PADDING + depth * HORIZONTAL_GAP,
        y: yById.get(id) ?? DEFAULT_PADDING,
        children: primaryChildren(id),
        hasChildren: allChildren.some(
          (childId) => parsed.parent[childId] === id,
        ),
        parentId: parsed.parent[id],
        branchColorVar: branchColorById.get(id),
        descendantCount: descendantCountById.get(id) ?? 0,
      },
    ];
  });

  const nodeById = new Map(visibleNodes.map((node) => [node.id, node]));
  const edges: MindMapViewEdge[] = [];

  for (const connection of parsed.connections) {
    const node = nodeById.get(connection.from);
    const child = nodeById.get(connection.to);
    if (!node || !child || collapsedNodeIds.has(node.id)) continue;
    edges.push({
      from: connection.from,
      to: connection.to,
      x1: node.x + MIND_MAP_NODE_WIDTH,
      y1: node.y + MIND_MAP_NODE_HEIGHT / 2,
      x2: child.x,
      y2: child.y + MIND_MAP_NODE_HEIGHT / 2,
      semanticRole: connection.semanticRole,
    });
  }

  return {
    rootId: parsed.rootId,
    nodes: visibleNodes,
    edges,
    visibleNodeIds: visibleNodes.map((node) => node.id),
    width:
      Math.max(...visible.map((item) => item.depth), 0) * HORIZONTAL_GAP +
      MIND_MAP_NODE_WIDTH +
      DEFAULT_PADDING * 2,
    height:
      Math.max(nextLeaf - 1, 0) * VERTICAL_GAP +
      DEFAULT_PADDING * 2 +
      MIND_MAP_NODE_HEIGHT,
  };
}

export function buildMindMapLayout(
  content: MindMapContent,
  collapsedNodeIds: ReadonlySet<string> = new Set(),
): MindMapLayout {
  const parsed: ParsedGraph = isV2(content)
    ? normalizeV2(content)
    : normalizeV1((content as MindMapContentV1).root);
  const visible = buildVisibleState(parsed, collapsedNodeIds);
  return buildLayoutFromVisible(parsed, visible, collapsedNodeIds);
}

export function nextVisibleNode(
  visibleNodeIds: string[],
  currentId: string | null,
  key: MindMapKeyDirection,
): string | null {
  if (visibleNodeIds.length === 0) return null;
  if (currentId === null) return visibleNodeIds[0] ?? null;

  const currentIndex = visibleNodeIds.indexOf(currentId);
  if (currentIndex < 0) return visibleNodeIds[0] ?? null;

  if (key === 'down' || key === 'right') {
    return visibleNodeIds[
      Math.min(currentIndex + 1, visibleNodeIds.length - 1)
    ]!;
  }
  if (key === 'up' || key === 'left') {
    return visibleNodeIds[Math.max(currentIndex - 1, 0)]!;
  }
  return visibleNodeIds[currentIndex] ?? null;
}

export const MIND_MAP_ASK_NODE_EVENT = 'educanvas.mind-map.ask-node';

export function buildAskNodeEventPayload(nodeId: string, nodeLabel: string) {
  return { nodeId, nodeLabel, requestedAt: Date.now() };
}
