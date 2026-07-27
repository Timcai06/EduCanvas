/**
 * 教学工具注册 — 定义教学领域 Tool 的类型擦除接口。
 *
 * ## RegisteredTeachingTool vs ToolKernelAdapter
 *
 * `RegisteredTeachingTool` 是本模块的"裸"教学工具定义 — 有 handler、Schema、name。
 * 它不能直接执行。必须通过 `adaptTeachingTool()` 提升为 `ToolKernelAdapter`，
 * 才能注册到 Tool Kernel 并参与授权/审批/幂等生命周期。
 *
 * ## 两个暴露级别
 *
 * - `model` — 工具会暴露给模型（在 tool_definitions 中发送）
 * - `runtime` — 工具只在服务端执行，模型不知道它的存在
 */

import {
  type TeachingState,
  type TeachingTool,
} from '@educanvas/teaching-core';
import { type z } from 'zod';

export type TeachingToolExposure = 'model' | 'runtime';
export type TeachingToolEffect = 'read' | 'write';

/** 教学 Tool handler 只能使用由 Profile 和 Tool Kernel 注入的可信上下文。 */
export interface TeachingToolHandlerContext {
  traceId: string;
  turnId: string;
  executionId: string;
  studentId: string;
  sessionId: string;
  knowledgeNodeId: string | null;
  state: TeachingState;
  invoker: TeachingToolExposure;
  signal: AbortSignal;
}

/** 类型擦除后的教学 Tool 定义；授权与执行生命周期不在本模块实现。 */
export interface RegisteredTeachingTool {
  name: TeachingTool;
  description: string;
  exposure: TeachingToolExposure;
  effect: TeachingToolEffect;
  timeoutMs: number;
  inputSchema: z.ZodType<unknown>;
  outputSchema: z.ZodType<unknown>;
  execute(
    input: unknown,
    context: TeachingToolHandlerContext,
  ): Promise<unknown>;
}

/**
 * 定义教育领域 Tool。此处只冻结 Schema 和 handler；Tool Kernel 是唯一执行者。
 */
export function defineTeachingTool<Input, Output>(definition: {
  name: TeachingTool;
  description: string;
  exposure: TeachingToolExposure;
  effect: TeachingToolEffect;
  timeoutMs: number;
  inputSchema: z.ZodType<Input>;
  outputSchema: z.ZodType<Output>;
  handler(
    input: Input,
    context: TeachingToolHandlerContext,
  ): Promise<Output> | Output;
}): RegisteredTeachingTool {
  if (!Number.isFinite(definition.timeoutMs) || definition.timeoutMs <= 0) {
    throw new Error('工具timeoutMs必须是正数');
  }
  return {
    name: definition.name,
    description: definition.description,
    exposure: definition.exposure,
    effect: definition.effect,
    timeoutMs: definition.timeoutMs,
    inputSchema: definition.inputSchema,
    outputSchema: definition.outputSchema,
    async execute(input, context) {
      return definition.handler(input as Input, context);
    },
  };
}
