import type {
  ModelToolDefinition,
  TurnApplicationCommand,
} from '@educanvas/agent-core';
import { buildAgentContext } from '../context-engine';
import { candidates, modelMessages } from './helpers';
import type { TurnApplicationDependencies } from './dependencies';
import type {
  TurnApplicationLifecycleSnapshot,
  TurnApplicationProfilePlan,
  TurnApplicationToolPolicy,
} from './ports';

/** @internal 已通过Context/Prompt防漂移校验的模型循环输入。 */
export interface PreparedTurnApplication {
  model: TurnApplicationProfilePlan['model'];
  answerMessages: ReturnType<typeof modelMessages>;
  synthesisMessages: ReturnType<typeof modelMessages>;
  toolPolicy?: TurnApplicationToolPolicy;
  toolDefinitions: readonly ModelToolDefinition[];
}

/**
 * @internal 准备阶段 — Context 选择 + Profile Plan 校验 + Tool 列表装配。
 *
 * ## 流程
 *
 * 1. Profile.prepare() → 返回 Plan（含 context 候选 + 模型配置 + 工具策略）
 * 2. buildAgentContext() → 预算驱动选择 Context Segment
 * 3. contextLedger.createOrGet() → 落账 Material 快照（防重放/防漂移）
 * 4. modelMessages() → Segment 绑定到 Prompt Message，校验 profile/system 角色一致性
 * 5. ToolKernel.listDefinitions() → 装配工具定义列表
 *
 * ## 安全保证
 *
 * - Context Prompt 防漂移：candidate.message 的 trim 内容必须与 segment.content 一致
 * - profile 只能出 system role，非 profile 不能出 system role
 * - synthesis 的 system message 必须来自 profile（不能是 conversation 注入）
 * - 用户消息必须在入选的 Segment 中（否则无效 Plan）
 * - promptVersion 必须是合法 semver 格式
 */

export async function prepareTurnApplication(input: {
  dependencies: TurnApplicationDependencies;
  command: TurnApplicationCommand;
  turn: TurnApplicationLifecycleSnapshot;
}): Promise<PreparedTurnApplication> {
  const { dependencies, command, turn } = input;
  const plan = await dependencies.profile.prepare({ command, turn });
  const allCandidates = candidates(plan.context);
  const built = buildAgentContext({
    profileVersion: plan.context.profileVersion,
    profile: plan.context.profile.map((candidate) => candidate.segment),
    conversation: plan.context.conversation.map(
      (candidate) => candidate.segment,
    ),
    sourcesAndAssets: plan.context.sourcesAndAssets.map(
      (candidate) => candidate.segment,
    ),
    memory:
      plan.context.memory.status === 'available'
        ? {
            status: 'available',
            version: plan.context.memory.version,
            segments: plan.context.memory.candidates.map(
              (candidate) => candidate.segment,
            ),
          }
        : plan.context.memory,
    maxSegments: plan.context.maxSegments,
    maxCharacters: plan.context.maxCharacters,
  });
  const contextSnapshot = await dependencies.contextLedger.createOrGet({
    operationId: command.operationId,
    actorId: command.actor.actorId,
    material: built.material,
  });
  if (contextSnapshot.replayed) {
    throw new Error('context_replay_requires_continuation');
  }
  const answerMessages = modelMessages(built.segments, allCandidates, 'answer');
  const synthesisMessages = modelMessages(
    built.segments,
    allCandidates,
    'synthesis',
  );
  if (
    !built.material.includedMessageIds.includes(turn.userMessageId) ||
    !answerMessages.some((message) => message.role === 'system') ||
    !answerMessages.some((message) => message.role === 'user') ||
    !Number.isSafeInteger(plan.model.maxToolRounds) ||
    plan.model.maxToolRounds < 1 ||
    plan.model.maxToolRounds > 4 ||
    !/^[a-z0-9][a-z0-9._-]{0,127}$/.test(plan.model.promptVersion) ||
    (plan.model.synthesisPromptVersion !== undefined &&
      !/^[a-z0-9][a-z0-9._-]{0,127}$/.test(plan.model.synthesisPromptVersion))
  ) {
    throw new Error('invalid_profile_plan');
  }
  const toolDefinitions =
    dependencies.toolKernel && plan.toolPolicy
      ? dependencies.toolKernel.listDefinitions(plan.toolPolicy)
      : [];
  return {
    model: plan.model,
    answerMessages,
    synthesisMessages,
    toolDefinitions,
    ...(plan.toolPolicy ? { toolPolicy: plan.toolPolicy } : {}),
  };
}
