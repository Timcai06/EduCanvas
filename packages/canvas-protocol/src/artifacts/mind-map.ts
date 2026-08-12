import { z } from 'zod';

const mindMapNodeIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/);

const mindMapNodeLabelSchema = z.string().min(1).max(120);

/**
 * 思维导图产物内容 Schema v1(M1 PR-J5 / M2)。
 * 数量与深度上限的原因:导图是"一屏读懂"的概览产物,120 节点/4层已超出
 * 可读极限,更大的图应该拆产物而不是放宽约束;上限同时封死 JSONB 内容的
 * 无界增长(artifact_versions.content 无独立大小约束,靠 Schema 兜底)。
 */
const mindMapLeafSchema = z
  .object({
    id: mindMapNodeIdSchema,
    label: mindMapNodeLabelSchema,
  })
  .strict();

type MindMapNodeInput = z.infer<typeof mindMapLeafSchema> & {
  children?: MindMapNodeInput[];
};

const mindMapNodeSchema: z.ZodType<MindMapNodeInput> = mindMapLeafSchema
  .extend({
    children: z.lazy(() => z.array(mindMapNodeSchema).max(12)).optional(),
  })
  .strict() as z.ZodType<MindMapNodeInput>;

export const MIND_MAP_CONTENT_VERSION_V1 = 1 as const;
export const MIND_MAP_CONTENT_VERSION_V2 = 2 as const;
/** 旧调用方仍以该名称读取 v1；新生成链必须显式使用 V2 常量。 */
export const MIND_MAP_CONTENT_VERSION = MIND_MAP_CONTENT_VERSION_V1;

export const mindMapSemanticRoleSchema = z.enum([
  'root',
  'topic',
  'subtopic',
  'detail',
  'question',
  'annotation',
  'action',
]);

export const mindMapLayoutHintSchema = z.enum([
  'auto',
  'tree',
  'radial',
  'timeline',
]);

export const mindMapEdgeRoleSchema = z.enum([
  'hierarchy',
  'association',
  'sequence',
  'contrast',
  'cause',
]);

const mindMapNodeV2Schema = z
  .object({
    id: mindMapNodeIdSchema,
    label: mindMapNodeLabelSchema,
    semanticRole: mindMapSemanticRoleSchema.optional(),
    layoutHint: mindMapLayoutHintSchema.optional(),
  })
  .strict();

type MindMapNodeV2Input = z.infer<typeof mindMapNodeV2Schema>;

const mindMapEdgeSchema = z
  .object({
    from: mindMapNodeIdSchema,
    to: mindMapNodeIdSchema,
    semanticRole: mindMapEdgeRoleSchema.optional(),
  })
  .strict();
type MindMapEdge = z.infer<typeof mindMapEdgeSchema>;

const mindMapGroupSchema = z
  .object({
    id: mindMapNodeIdSchema,
    label: mindMapNodeLabelSchema,
    nodeIds: z.array(mindMapNodeIdSchema).min(1).max(120),
    semanticRole: mindMapSemanticRoleSchema.optional(),
  })
  .strict();
type MindMapGroup = z.infer<typeof mindMapGroupSchema>;

const mindMapContentV1Schema = z
  .object({
    contentVersion: z.literal(MIND_MAP_CONTENT_VERSION_V1),
    root: mindMapNodeSchema,
  })
  .strict()
  .superRefine((value, context) => {
    let count = 0;
    let tooDeep = false;
    const walk = (node: MindMapNodeInput, depth: number) => {
      count += 1;
      if (depth > 4) tooDeep = true;
      for (const child of node.children ?? []) walk(child, depth + 1);
    };
    walk(value.root, 1);
    if (count > 120) {
      context.addIssue({
        code: 'custom',
        message: '思维导图节点数超过 120 上限',
      });
    }
    if (tooDeep) {
      context.addIssue({
        code: 'custom',
        message: '思维导图深度超过 4 层上限',
      });
    }
  });

export const mindMapContentV2Schema = z
  .object({
    contentVersion: z.literal(MIND_MAP_CONTENT_VERSION_V2),
    rootNodeId: mindMapNodeIdSchema,
    nodes: z.array(mindMapNodeV2Schema).min(1).max(120),
    edges: z.array(mindMapEdgeSchema).max(240),
    groups: z.array(mindMapGroupSchema).max(24).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const nodeCountById: Record<string, number> = Object.create(null);
    const nodeSet = new Set<string>();
    for (const node of value.nodes) {
      nodeCountById[node.id] = (nodeCountById[node.id] ?? 0) + 1;
      nodeSet.add(node.id);
    }
    for (const [id, count] of Object.entries(nodeCountById)) {
      if (count > 1) {
        context.addIssue({
          code: 'custom',
          message: `节点 id 重复: ${id}`,
        });
      }
    }

    if (!nodeSet.has(value.rootNodeId)) {
      context.addIssue({
        code: 'custom',
        message: '根节点 id 不存在于 nodes',
      });
      return;
    }

    const outgoing = new Map<string, string[]>();
    const incoming: Record<string, number> = Object.create(null);
    for (const edge of value.edges) {
      if (edge.from === edge.to) {
        context.addIssue({
          code: 'custom',
          message: `存在自环边: ${edge.from} -> ${edge.to}`,
        });
      }
      if (!nodeSet.has(edge.from) || !nodeSet.has(edge.to)) {
        context.addIssue({
          code: 'custom',
          message: `边引用不存在节点: ${edge.from} -> ${edge.to}`,
        });
      }
      /* 只有 hierarchy（以及兼容旧 v2 的未标注边）定义树骨架。关联、因果、
         对比和顺序边只表达语义，不得制造第二父节点或改变深度。 */
      if (
        edge.semanticRole === undefined ||
        edge.semanticRole === 'hierarchy'
      ) {
        const list = outgoing.get(edge.from);
        if (list) list.push(edge.to);
        else outgoing.set(edge.from, [edge.to]);
        incoming[edge.to] = (incoming[edge.to] ?? 0) + 1;
      }
    }
    for (const [nodeId, parentCount] of Object.entries(incoming)) {
      if (parentCount > 1) {
        context.addIssue({
          code: 'custom',
          message: `层级节点只能有一个父级: ${nodeId}`,
        });
      }
    }

    const seenEdge = new Set<string>();
    for (const edge of value.edges) {
      const key = `${edge.from}→${edge.to}`;
      if (seenEdge.has(key)) {
        context.addIssue({
          code: 'custom',
          message: `重复边: ${edge.from} -> ${edge.to}`,
        });
      }
      seenEdge.add(key);
    }

    const groupIds = new Set<string>();
    for (const group of value.groups ?? []) {
      if (groupIds.has(group.id)) {
        context.addIssue({
          code: 'custom',
          message: `分组 id 重复: ${group.id}`,
        });
      }
      groupIds.add(group.id);
      const seenNodeIds = new Set<string>();
      for (const nodeId of group.nodeIds) {
        if (!nodeSet.has(nodeId)) {
          context.addIssue({
            code: 'custom',
            message: `分组 ${group.id} 引用了不存在节点: ${nodeId}`,
          });
        }
        if (seenNodeIds.has(nodeId)) {
          context.addIssue({
            code: 'custom',
            message: `分组 ${group.id} 包含重复节点: ${nodeId}`,
          });
        }
        seenNodeIds.add(nodeId);
      }
    }

    const incomingRoots = value.nodes.filter(
      (node) => (incoming[node.id] ?? 0) === 0,
    );
    if (incomingRoots.length !== 1) {
      context.addIssue({
        code: 'custom',
        message: '平面图必须只有一个无父级节点',
      });
      return;
    }
    if (incomingRoots[0]!.id !== value.rootNodeId) {
      context.addIssue({
        code: 'custom',
        message: 'rootNodeId 必须与唯一无父级节点一致',
      });
      return;
    }

    const depthByNode = new Map<string, number>();
    const visit = (nodeId: string, stack: Set<string>): number => {
      if (stack.has(nodeId)) {
        context.addIssue({
          code: 'custom',
          message: `检测到环: ${nodeId}`,
        });
        return 0;
      }
      const cached = depthByNode.get(nodeId);
      if (cached !== undefined) return cached;
      stack.add(nodeId);
      let maxChild = 0;
      for (const childId of outgoing.get(nodeId) ?? []) {
        maxChild = Math.max(maxChild, visit(childId, stack));
      }
      stack.delete(nodeId);
      const depth = maxChild + 1;
      depthByNode.set(nodeId, depth);
      return depth;
    };
    const depth = visit(value.rootNodeId, new Set());
    if (depth > 4) {
      context.addIssue({
        code: 'custom',
        message: '思维导图深度超过 4 层上限',
      });
    }

    const queue = [value.rootNodeId];
    const visited = new Set<string>([value.rootNodeId]);
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const child of outgoing.get(current) ?? []) {
        if (!visited.has(child)) {
          visited.add(child);
          queue.push(child);
        }
      }
    }
    if (visited.size !== value.nodes.length) {
      context.addIssue({
        code: 'custom',
        message: '存在与 root 不可达节点',
      });
    }
  });

export const mindMapContentSchema = z.union([
  mindMapContentV1Schema,
  mindMapContentV2Schema,
]);

export type MindMapContent = z.infer<typeof mindMapContentSchema>;
export type MindMapNode = MindMapNodeInput;
export type MindMapContentV1 = z.infer<typeof mindMapContentV1Schema>;
export type MindMapContentV2 = z.infer<typeof mindMapContentV2Schema>;
export type MindMapNodeV2 = MindMapNodeV2Input;
export type MindMapEdgeV2 = MindMapEdge;
export type MindMapGroupV2 = MindMapGroup;
