import type {
  BudgetBreachReason,
  ModelAbortSignal,
  ModelMessage,
  ModelToolDefinition,
  ModelToolResult,
  ModelUsage,
  NormalizedModelError,
  StreamTurnTextRequest,
  TurnModelEvent,
} from '@educanvas/agent-core';
import type { ModelRunResult, ParsedToolCall } from './turn-engine';

export interface AgentLoopPrompt {
  taskAlias: StreamTurnTextRequest['taskAlias'];
  modelAlias: StreamTurnTextRequest['modelAlias'];
  promptVersion: string;
  messages: readonly ModelMessage[];
  tools: readonly ModelToolDefinition[];
}

export interface AgentLoopToolSuccess<TDetail> {
  call: ParsedToolCall;
  modelResult: ModelToolResult;
  detail: TDetail;
}

export type AgentLoopToolBatch<TDetail, TFailure> =
  | { ok: true; results: readonly AgentLoopToolSuccess<TDetail>[] }
  | { ok: false; failure: TFailure };

export interface AgentLoopModelRunLifecycle<TContext> {
  /** 在供应商调用前建立脱敏 Model Run；正文只能用于本进程哈希，不能越过实现边界。 */
  start(input: {
    run: number;
    request: StreamTurnTextRequest;
  }): Promise<TContext>;
  /** 只在 Runtime 完成协议校验后结算，避免把非法供应商流记成成功。 */
  settle(input: {
    run: number;
    request: StreamTurnTextRequest;
    context: TContext;
    outcome: ModelRunResult;
  }): Promise<void>;
}

/**
 * Turn 使用预算执行器端口（Q03）— 服务端在 LOOP 阶段强制执行预算。
 * Agent Loop 不关心预算如何记账，只管在固定检查点调用；超预算时
 * 必须以 BUDGET_EXCEEDED 终态终止，不得伪装为成功。
 */
export interface AgentLoopUsageBudgetPort {
  /** 每次模型调用尝试前（含重试）。返回 reason 表示超预算。 */
  checkBeforeModelCall(input: {
    run: number;
    attempt: number;
    request: StreamTurnTextRequest;
  }): BudgetBreachReason | null;
  /** usage 事件到达时记账（最后一次到达为准）。 */
  observeUsage(usage: ModelUsage): void;
  /** 每次 run 收敛后（成功）复查累计量。 */
  checkAfterModelRun(input: {
    run: number;
    ok: boolean;
    textCharacters: number;
  }): BudgetBreachReason | null;
  /** 每批工具执行前投影检查。 */
  checkBeforeToolExecution(input: {
    calls: readonly { callId: string; tool: string }[];
  }): BudgetBreachReason | null;
  /** 工具结果落地（喂回模型前）：计数并按截断协议处理超限结果。 */
  observeToolResult(result: ModelToolResult): ModelToolResult;
  /** 终态前只复查累计预算，不再结算或增加调用计数。 */
  checkBeforeCompletion?(): BudgetBreachReason | null;
}

export interface AgentLoopCommand<TDetail, TFailure, TModelRunContext = never> {
  traceId: string;
  turnId: string;
  answer: AgentLoopPrompt;
  synthesis: Omit<AgentLoopPrompt, 'tools'>;
  maxToolRounds: number;
  signal?: ModelAbortSignal;
  modelRunLifecycle?: AgentLoopModelRunLifecycle<TModelRunContext>;
  usageBudget?: AgentLoopUsageBudgetPort;
  /** 可信 Profile 的完成要求；仅允许一次补救调用，仍受取消与预算约束。 */
  completionRequirement?: {
    tool: string;
    remediationPrompt: string;
    isSatisfied(results: readonly ModelToolResult[]): boolean;
  };
  executeTools(
    calls: readonly ParsedToolCall[],
    context: {
      round: number;
      traceId: string;
      turnId: string;
      modelRun: TModelRunContext | undefined;
    },
  ): Promise<AgentLoopToolBatch<TDetail, TFailure>>;
}

export type AgentLoopEvent<TDetail, TFailure> =
  | { type: 'model'; run: number; event: TurnModelEvent }
  | {
      type: 'model.retry';
      run: number;
      attempt: number;
      error: NormalizedModelError;
    }
  | { type: 'tool.started'; run: number; call: ParsedToolCall }
  | { type: 'tool.result'; run: number; result: AgentLoopToolSuccess<TDetail> }
  | { type: 'completed'; modelRunCount: number }
  | (
      | {
          type: 'failed';
          code:
            | 'MODEL_GATEWAY_FAILED'
            | 'MODEL_ABORTED'
            | 'INVALID_MODEL_STREAM'
            | 'DUPLICATE_TOOL_CALL_ID'
            | 'RUNTIME_FAILED';
          error: NormalizedModelError;
        }
      | {
          type: 'failed';
          code: 'BUDGET_EXCEEDED';
          /** 超预算的具体维度，供账本/Trace/指标使用。 */
          budgetReason: BudgetBreachReason;
          error: NormalizedModelError;
        }
    )
  | { type: 'tool.failed'; failure: TFailure };
