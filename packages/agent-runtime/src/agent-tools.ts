import type { ModelToolDefinition } from '@educanvas/agent-core';
import { z } from 'zod';

/**
 * 通用 Agent 工具注册表(M3 最小 Runtime)。与 K12 TeachingToolExecutor 的
 * 差异:没有教学状态白名单——通用工具的可见性由组合根在构造时决定(未配置
 * 即不注册)。相同的纪律:编译期显式清单、入参出参双向 Zod、超时硬边界、
 * 失败只暴露稳定码。
 */

export interface AgentToolContext {
  traceId: string;
  turnId: string;
  subjectId: string;
  conversationId: string;
  /** 兼容旧调用者可选；经Tool Kernel执行时始终注入。 */
  signal?: AbortSignal;
}

export interface AgentTool<Input = unknown, Output = unknown> {
  name: string;
  description: string;
  inputSchema: z.ZodType<Input>;
  outputSchema: z.ZodType<Output>;
  timeoutMs: number;
  handler: (input: Input, context: AgentToolContext) => Promise<Output>;
}

export type AgentToolFailureCode =
  | 'TOOL_NOT_AVAILABLE'
  | 'TOOL_INPUT_INVALID'
  | 'TOOL_TIMEOUT'
  | 'TOOL_OUTPUT_INVALID'
  | 'TOOL_FAILED';

export type AgentToolExecution =
  | { ok: true; tool: string; output: unknown }
  | { ok: false; tool: string; code: AgentToolFailureCode; retryable: boolean };

const TOOL_NAME_PATTERN = /^[a-z][A-Za-z0-9]*$/;

/**
 * 注册表内部的顶类型。不能直接用 AgentTool<never,unknown>:inputSchema 在
 * Input 上协变(ZodType<X> ⊄ ZodType<never>),handler 在 Input 上逆变——
 * 结构化拆开各取正确的极值。
 */
interface AnyAgentTool {
  name: string;
  description: string;
  inputSchema: z.ZodType<unknown>;
  outputSchema: z.ZodType<unknown>;
  timeoutMs: number;
  handler: (input: never, context: AgentToolContext) => Promise<unknown>;
}

export class AgentToolRegistry {
  private readonly tools = new Map<string, AnyAgentTool>();

  constructor(tools: readonly AnyAgentTool[]) {
    for (const tool of tools) {
      if (!TOOL_NAME_PATTERN.test(tool.name) || this.tools.has(tool.name)) {
        throw new Error(`非法或重复的工具名: ${tool.name}`);
      }
      this.tools.set(tool.name, tool);
    }
  }

  get size(): number {
    return this.tools.size;
  }

  /** 供模型请求体使用的定义;稳定排序保证 promptHash 可复现。 */
  listDefinitions(): readonly ModelToolDefinition[] {
    return [...this.tools.values()]
      .sort((left, right) => (left.name < right.name ? -1 : 1))
      .map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: z.toJSONSchema(tool.inputSchema) as Record<
          string,
          unknown
        >,
      }));
  }

  async execute(
    call: { tool: string; arguments: unknown },
    context: AgentToolContext,
  ): Promise<AgentToolExecution> {
    const tool = this.tools.get(call.tool);
    if (!tool) {
      return {
        ok: false,
        tool: call.tool,
        code: 'TOOL_NOT_AVAILABLE',
        retryable: false,
      };
    }
    const input = tool.inputSchema.safeParse(call.arguments);
    if (!input.success) {
      return {
        ok: false,
        tool: tool.name,
        code: 'TOOL_INPUT_INVALID',
        retryable: false,
      };
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const output = await Promise.race([
        tool.handler(input.data as never, context),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('tool_timeout')),
            tool.timeoutMs,
          );
        }),
      ]);
      const parsedOutput = tool.outputSchema.safeParse(output);
      if (!parsedOutput.success) {
        return {
          ok: false,
          tool: tool.name,
          code: 'TOOL_OUTPUT_INVALID',
          retryable: false,
        };
      }
      return { ok: true, tool: tool.name, output: parsedOutput.data };
    } catch (error) {
      return {
        ok: false,
        tool: tool.name,
        code:
          (error as Error).message === 'tool_timeout'
            ? 'TOOL_TIMEOUT'
            : 'TOOL_FAILED',
        retryable: true,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
