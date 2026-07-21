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
 * 对已由可信仓储完成Actor/Notebook过滤的Segment做确定性预算选择。
 * 本层不读取数据库、不授予权限，也不把“尚未实现的Memory”伪装为空结果。
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
