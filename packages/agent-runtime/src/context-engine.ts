import type { AgentTurnContextMaterial } from '@educanvas/agent-core';

export const CONTEXT_ENGINE_VERSION = 'context-engine-v1' as const;
export type ContextSegmentKind =
  | 'profile'
  | 'conversation'
  | 'source'
  | 'asset'
  | 'memory'
  | 'tool_call'
  | 'tool_result';

export interface ContextSegment {
  id: string;
  kind: ContextSegmentKind;
  content: string;
  /** 数值越大越优先；相同优先级保持输入顺序。 */
  priority: number;
  required?: boolean;
  messageId?: string;
  assetVersionId?: string;
  /** tool_call/tool_result必须使用相同pairKey成对进入或成对省略。 */
  pairKey?: string;
}

export type ContextMemoryInput =
  | { status: 'unavailable'; reason: 'not_implemented' | 'disabled' }
  | {
      status: 'available';
      version: string;
      segments: readonly ContextSegment[];
    };

export interface BuiltAgentContext {
  version: typeof CONTEXT_ENGINE_VERSION;
  segments: readonly ContextSegment[];
  material: AgentTurnContextMaterial;
  unavailableCapabilities: readonly 'memory'[];
}

export class ContextEngineInputError extends Error {
  readonly code = 'invalid_context_engine_input';
}

function validateVersion(value: string): boolean {
  return /^[a-z0-9][a-z0-9._-]{0,31}$/.test(value);
}

/**
 * Context 引擎 — 确定性 Segment 预算选择。
 *
 * ## 输入约束
 *
 * 所有 Segment 必须已由可信仓储完成 Actor/Notebook 权限过滤。
 * 本层不读取数据库、不授予权限、不把”尚未实现的 Memory”伪装为空结果。
 *
 * ## 处理流程
 *
 * 1. **校验** — 版本格式、预算范围、Segment ID 唯一性、必需字段
 * 2. **配对** — 使用 pairKey 将 tool_call + tool_result 绑定为不可分割的 unit
 *     （必须成对出现，否则拒绝；required 的 pair 不完整也拒绝）
 * 3. **排序** — required 优先 → 高 priority 优先 → 原始输入顺序（稳定排序）
 * 4. **截断** — 按 maxSegments + maxCharacters 预算从高到低选入，required 超出预算则报错
 * 5. **还原顺序** — 选中项按原始输入顺序排列（而非 priority 顺序）
 */

export function buildAgentContext(input: {
  profileVersion: string;
  profile: readonly ContextSegment[];
  conversation: readonly ContextSegment[];
  sourcesAndAssets: readonly ContextSegment[];
  memory: ContextMemoryInput;
  maxSegments?: number;
  maxCharacters?: number;
}): BuiltAgentContext {
  const maxSegments = input.maxSegments ?? 100;
  const maxCharacters = input.maxCharacters ?? 128_000;
  const memoryVersion =
    input.memory.status === 'available'
      ? input.memory.version
      : input.memory.reason;
  if (
    !validateVersion(input.profileVersion) ||
    !validateVersion(memoryVersion) ||
    !Number.isSafeInteger(maxSegments) ||
    maxSegments < 1 ||
    maxSegments > 100 ||
    !Number.isSafeInteger(maxCharacters) ||
    maxCharacters < 1 ||
    maxCharacters > 128_000
  ) {
    throw new ContextEngineInputError('Context版本或预算无效');
  }
  const all = [
    ...input.profile,
    ...input.conversation,
    ...input.sourcesAndAssets,
    ...(input.memory.status === 'available' ? input.memory.segments : []),
  ];
  const unique = (values: readonly (string | undefined)[]) => {
    const present = values.filter(
      (value): value is string => value !== undefined,
    );
    return new Set(present).size === present.length;
  };
  if (
    all.length > 500 ||
    !unique(all.map((segment) => segment.id)) ||
    !unique(all.map((segment) => segment.messageId)) ||
    !unique(all.map((segment) => segment.assetVersionId)) ||
    all.some(
      (segment) =>
        !segment.id ||
        segment.id.length > 256 ||
        !segment.content.trim() ||
        segment.content.length > 64_000 ||
        !Number.isSafeInteger(segment.priority) ||
        segment.priority < 0 ||
        segment.priority > 100 ||
        (segment.kind === 'conversation' && !segment.messageId) ||
        ((segment.kind === 'source' || segment.kind === 'asset') &&
          !segment.assetVersionId) ||
        ((segment.kind === 'tool_call' || segment.kind === 'tool_result') &&
          !segment.messageId) ||
        ((segment.kind === 'tool_call' || segment.kind === 'tool_result') &&
          !segment.pairKey) ||
        (segment.pairKey !== undefined && segment.pairKey.length > 128),
    )
  ) {
    throw new ContextEngineInputError('Context Segment无效或超过上限');
  }
  const indexed = all.map((segment, index) => ({
    segment: { ...segment, content: segment.content.trim() },
    index,
  }));
  /**
   * 步骤 1：Segment 去重与范围校验。
   * tool_call/tool_result 通过 pairKey 成对绑定为不可分割的 unit。
   * required Segment 的 pair 不完整 → 直接报错（而非默默丢弃）。
   */
  const paired = new Map<string, typeof indexed>();
  const units: (typeof indexed)[] = [];
  for (const item of indexed) {
    if (!item.segment.pairKey) units.push([item]);
    else {
      const group = paired.get(item.segment.pairKey) ?? [];
      group.push(item);
      paired.set(item.segment.pairKey, group);
    }
  }
  for (const group of paired.values()) {
    const kinds = group.map((item) => item.segment.kind).sort();
    if (
      group.length === 2 &&
      kinds[0] === 'tool_call' &&
      kinds[1] === 'tool_result'
    ) {
      units.push(group);
    } else if (group.some((item) => item.segment.required)) {
      throw new ContextEngineInputError('必需Tool Pair不完整');
    }
  }
  /**
   * 步骤 2：排序 — required 优先 → 高 priority 优先 → 原始输入顺序。
   * required Segment 必须被选入，即使 priority 较低也排最前面。
   */
  units.sort((left, right) => {
    const leftRequired = left.some((item) => item.segment.required);
    const rightRequired = right.some((item) => item.segment.required);
    if (leftRequired !== rightRequired) return leftRequired ? -1 : 1;
    const priority =
      Math.max(...right.map((item) => item.segment.priority)) -
      Math.max(...left.map((item) => item.segment.priority));
    return priority || left[0]!.index - right[0]!.index;
  });
  const selected: typeof indexed = [];
  let characterCount = 0;
  for (const unit of units) {
    const unitCharacters = unit.reduce(
      (total, item) => total + item.segment.content.length,
      0,
    );
    const fits =
      selected.length + unit.length <= maxSegments &&
      characterCount + unitCharacters <= maxCharacters;
    /**
     * 步骤 3：预算截断 — required 超出预算则报错（而非默默丢弃），
     * 非 required 超出预算则跳过。
     */
    if (!fits) {
      if (unit.some((item) => item.segment.required)) {
        throw new ContextEngineInputError('必需Profile Context超过预算');
      }
      continue;
    }
    selected.push(...unit);
    characterCount += unitCharacters;
  }
  selected.sort((left, right) => left.index - right.index);
  const conversationIds = new Set(
    input.conversation.map((segment) => segment.id),
  );
  const selectedConversationCount = selected.filter((item) =>
    conversationIds.has(item.segment.id),
  ).length;
  return {
    version: CONTEXT_ENGINE_VERSION,
    segments: selected.map((item) => item.segment),
    material: {
      builderVersion: `${CONTEXT_ENGINE_VERSION}.${input.profileVersion}.memory-${memoryVersion}`,
      includedMessageIds: selected
        .map((item) => item.segment.messageId)
        .filter((id): id is string => id !== undefined),
      selectedAssetVersionIds: selected
        .map((item) => item.segment.assetVersionId)
        .filter((id): id is string => id !== undefined),
      omittedMessageCount:
        input.conversation.length - selectedConversationCount,
      characterCount,
    },
    unavailableCapabilities:
      input.memory.status === 'unavailable' ? ['memory'] : [],
  };
}
