import { type z } from 'zod';

/** Local Tool 只能从 Tool Kernel 注入可信身份与取消信号。 */
export interface AgentToolContext {
  traceId: string;
  turnId: string;
  subjectId: string;
  conversationId: string;
  signal?: AbortSignal;
}

/**
 * 入口本地能力的最小定义；授权、副作用、Schema 执行与超时统一由 Tool Kernel 负责。
 */
export interface AgentTool<Input = unknown, Output = unknown> {
  name: string;
  description: string;
  inputSchema: z.ZodType<Input>;
  outputSchema: z.ZodType<Output>;
  timeoutMs: number;
  handler: (input: Input, context: AgentToolContext) => Promise<Output>;
}
