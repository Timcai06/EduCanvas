import type {
  DrizzleAgentToolCallRepository,
  DrizzleMcpIntentRepository,
  DrizzlePlatformTurnRepository,
  DrizzleToolEffectRepository,
} from '@educanvas/db';
import type { OperationContinuationResumeAdapter } from '../tasks/continue-operation';

type ResumeInput = Parameters<OperationContinuationResumeAdapter['resume']>[0];

export interface McpContinuationRepositories {
  intents: Pick<
    DrizzleMcpIntentRepository,
    'getForResume' | 'markDispatching' | 'settle'
  >;
  calls: Pick<DrizzleAgentToolCallRepository, 'markRunning' | 'settle'>;
  effects: Pick<DrizzleToolEffectRepository, 'get' | 'intend' | 'settle'>;
  turns: Pick<DrizzlePlatformTurnRepository, 'settleTurn'>;
}

async function settleTurn(
  input: ResumeInput,
  repositories: McpContinuationRepositories,
  status: 'completed' | 'failed',
  content: string,
  failureCode?: string,
) {
  return repositories.turns.settleTurn({
    conversationId: input.scope.conversationId,
    trustedSubjectId: input.scope.actorId,
    turnId: input.scope.operationId,
    status,
    content,
    failureCode,
    operationTerminalWriter: 'gateway',
  });
}

export async function completeRecoveredMcpDispatch(input: {
  resume: ResumeInput;
  repositories: McpContinuationRepositories;
  modelToolName: string;
}) {
  const { resume, repositories } = input;
  const common = {
    operationId: resume.scope.operationId,
    actorId: resume.scope.actorId,
  };
  await repositories.calls.settle({
    ...common,
    toolCallId: resume.continuation.work.toolCallId,
    status: 'succeeded',
    durationMs: 0,
    result: { status: 'committed', recovered: true },
  });
  await repositories.intents.settle({
    resumeRef: resume.continuation.work.resumeRef,
    ...common,
    status: 'completed',
  });
  const settled = await settleTurn(
    resume,
    repositories,
    'completed',
    `已完成已批准的外部工具操作：${input.modelToolName}。`,
  );
  return {
    status: 'completed' as const,
    messageId: settled.assistantMessage.id,
  };
}

export async function settleMcpDispatchUnknown(input: {
  resume: ResumeInput;
  repositories: McpContinuationRepositories;
  effectId?: string;
}) {
  const { resume, repositories } = input;
  const common = {
    operationId: resume.scope.operationId,
    actorId: resume.scope.actorId,
  };
  if (input.effectId) {
    await repositories.effects.settle({
      ...common,
      effectId: input.effectId,
      status: 'outcome_unknown',
      code: 'mcp_dispatch_outcome_unknown',
    });
  }
  await repositories.calls.settle({
    ...common,
    toolCallId: resume.continuation.work.toolCallId,
    status: 'outcome_unknown',
    code: 'mcp_dispatch_outcome_unknown',
    retryable: false,
    durationMs: 0,
  });
  await repositories.intents.settle({
    resumeRef: resume.continuation.work.resumeRef,
    ...common,
    status: 'outcome_unknown',
  });
  await settleTurn(
    resume,
    repositories,
    'failed',
    '外部工具可能已执行，但结果无法确认。为避免重复操作，EduCanvas 没有自动重试。',
    'mcp_dispatch_outcome_unknown',
  );
  return {
    status: 'failed' as const,
    continuationFailureCode: 'mcp_dispatch_outcome_unknown',
    operationFailureCode: 'RUNTIME_FAILED' as const,
    retryable: false,
  };
}

/** 先信任本地Effect Ledger终态；只有intended才降级为未知，绝不再次外呼。 */
export async function reconcileMcpDispatch(input: {
  resume: ResumeInput;
  repositories: McpContinuationRepositories;
  modelToolName: string;
}) {
  const effect = await input.repositories.effects.get({
    operationId: input.resume.scope.operationId,
    actorId: input.resume.scope.actorId,
    effectKey: input.resume.continuation.work.resumeRef,
  });
  if (effect?.status === 'committed') {
    return completeRecoveredMcpDispatch(input);
  }
  return settleMcpDispatchUnknown({
    resume: input.resume,
    repositories: input.repositories,
    effectId: effect?.status === 'intended' ? effect.id : undefined,
  });
}
