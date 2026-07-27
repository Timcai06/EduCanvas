/**
 * 教学 Tool → Tool Kernel Adapter 适配器。
 *
 * ## 为什么需要适配
 *
 * `RegisteredTeachingTool` 有自己的 handler 接口（`TeachingToolHandlerContext`），
 * `ToolKernel` 期望的是 `ToolKernelAdapter` 接口（`ToolAdapterInvocationContext`）。
 * 本模块的 `adaptTeachingTool()` 做这层适配 — 解包 Kernel 上下文，注入教学 Profile，
 * 再调用教学 handler。
 *
 * ## 权限边界
 *
 * 教学状态白名单由 Profile 能力集（capabilities/approvedCapabilities）表达，
 * 本 Adapter 只做上下文字段映射，不自行放宽 Kernel 授权。
 */

import {
  type ToolRiskLevel,
  type ToolKernelAdapter,
} from '@educanvas/agent-runtime';
import { teachingStateSchema } from '@educanvas/teaching-core';
import { z } from 'zod';
import type { RegisteredTeachingTool } from './teaching-tool';

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
