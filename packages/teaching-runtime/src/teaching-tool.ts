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
