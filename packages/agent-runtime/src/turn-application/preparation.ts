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

/** @internal 选择并落账Context，随后校验Profile模型计划；不得调用Provider。 */
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
