import type {
  ToolAdapterInvocationContext,
  ToolKernelExecuteRequest,
} from './contracts';

/** @internal 从可信请求投影Adapter上下文，不转发capability集合或模型参数。 */
export function buildInvocationContext(
  request: ToolKernelExecuteRequest,
  signal: AbortSignal,
): ToolAdapterInvocationContext {
  return {
    operationId: request.context.operationId,
    executionId: request.context.executionId,
    conversationId: request.context.conversationId,
    traceId: request.context.traceId,
    actorId: request.context.actorId,
    agentId: request.context.agentId,
    notebookId: request.context.notebookId,
    profileId: request.context.profileId,
    channel: request.context.channel,
    environment: request.context.environment,
    credentialHandle: request.context.credentialHandle ?? null,
    profileContext: request.context.profileContext ?? {},
    signal,
  };
}
