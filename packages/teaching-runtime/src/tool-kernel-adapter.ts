import {
  type ToolRiskLevel,
  type ToolKernelAdapter,
} from '@educanvas/agent-runtime';
import { teachingStateSchema } from '@educanvas/teaching-core';
import { z } from 'zod';
import type { RegisteredTeachingTool } from './tool-executor';

const teachingProfileContextSchema = z
  .object({
    studentId: z.string().min(1).max(160),
    sessionId: z.uuid(),
    knowledgeNodeId: z.string().min(1).max(256).nullable(),
    state: teachingStateSchema,
  })
  .strict();

/**
 * 把现有Teaching Tool提升为Kernel Adapter；教学状态白名单由Profile能力集表达，
 * 本Adapter只验证纵向上下文并注入旧handler，不能自行放宽Kernel授权。
 */
export function adaptTeachingTool(
  tool: RegisteredTeachingTool,
  policy: { capability: string; risk: ToolRiskLevel },
): ToolKernelAdapter {
  return {
    name: tool.name,
    description: tool.description,
    source: 'teaching',
    capability: policy.capability,
    risk: policy.risk,
    exposure: tool.exposure,
    effect: tool.effect,
    timeoutMs: tool.timeoutMs,
    inputSchema: tool.inputSchema,
    outputSchema: tool.outputSchema,
    async invoke(input, context) {
      const profile = teachingProfileContextSchema.parse(
        context.profileContext,
      );
      return tool.execute(input, {
        traceId: context.traceId,
        turnId: context.operationId,
        executionId: context.executionId,
        studentId: profile.studentId,
        sessionId: profile.sessionId,
        knowledgeNodeId: profile.knowledgeNodeId,
        state: profile.state,
        invoker: tool.exposure,
        signal: context.signal,
      });
    },
  };
}
