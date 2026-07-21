import type { AgentToolEffect, AgentToolExposure } from '@educanvas/agent-core';
import type { AgentTool } from './agent-tools';
import type { ToolKernelAdapter, ToolRiskLevel } from './tool-kernel';

/** 把现有Local AgentTool提升为Kernel Adapter；授权元数据必须由服务端静态注册。 */
export function adaptAgentTool<Input, Output>(
  tool: AgentTool<Input, Output>,
  policy: {
    capability: string;
    risk: ToolRiskLevel;
    effect: AgentToolEffect;
    exposure?: AgentToolExposure;
  },
): ToolKernelAdapter<Input, Output> {
  return {
    name: tool.name,
    description: tool.description,
    source: 'local',
    capability: policy.capability,
    risk: policy.risk,
    effect: policy.effect,
    exposure: policy.exposure ?? 'model',
    timeoutMs: tool.timeoutMs,
    inputSchema: tool.inputSchema,
    outputSchema: tool.outputSchema,
    invoke(input, context) {
      return tool.handler(input, {
        traceId: context.traceId,
        turnId: context.operationId,
        subjectId: context.actorId,
        conversationId: context.conversationId,
        signal: context.signal,
      });
    },
  };
}
