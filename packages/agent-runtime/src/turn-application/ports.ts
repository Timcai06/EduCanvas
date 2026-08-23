import type {
  ModelAbortSignal,
  ModelMessage,
  ModelToolDefinition,
  StreamingTaskAlias,
  TurnApplicationCommand,
  TurnApplicationEvent,
  TurnApplicationFailureCode,
  TurnUsageBudget,
  W3cTraceCarrier,
} from '@educanvas/agent-core';
import type { ContextSegment } from '../context/context-engine';
import type {
  ToolKernelExecuteRequest,
  ToolKernelPolicyContext,
  ToolKernelResult,
} from '../tool-kernel';

/**
 * Turn Application 的公开 Port 与 Plan/Snapshot/Guard 类型。
 * 拆分自原 turn-application.ts，仅承载接口与类型声明，不含任何运行时实现，
 * 便于 Transport/Profile/Provider 侧独立引用而不牵动主编排代码。
 */

/** 三类入口共享的唯一 Turn 应用边界。 */
export interface TurnApplicationPort {
  run(command: TurnApplicationCommand): AsyncIterable<TurnApplicationEvent>;
}

export interface TurnApplicationLifecycleSnapshot {
  operationId: string;
  traceId: string;
  userMessageId: string;
  assistantMessageId: string;
  replayed: boolean;
}

export type TurnApplicationProfileEvent = Extract<
  TurnApplicationEvent,
  {
    type:
      | 'message.citation'
      | 'artifact.proposed'
      | 'artifact.version_added'
      | 'artifact.generation_progress'
      | 'artifact.failed';
  }
>;

/**
 * Operation/Message 的唯一写入边界。实现必须重新验证 Actor、Notebook 与
 * Conversation；Gateway 已存在的 Operation 只能 attach，其他入口只能 create。
 */
export interface TurnApplicationLifecyclePort {
  begin(
    command: TurnApplicationCommand,
  ): Promise<TurnApplicationLifecycleSnapshot>;
  replay(input: {
    command: TurnApplicationCommand;
    turn: TurnApplicationLifecycleSnapshot;
  }): Promise<readonly TurnApplicationEvent[]>;
  settle(input: {
    command: TurnApplicationCommand;
    turn: TurnApplicationLifecycleSnapshot;
    status: 'completed' | 'failed' | 'cancelled';
    content: string;
    failureCode?: TurnApplicationFailureCode | null;
    /** Gateway terminal intent must preserve the public retry decision across restart. */
    retryable?: boolean;
    citationMarkers?: readonly number[];
  }): Promise<readonly TurnApplicationProfileEvent[]>;
}

/** Segment 与实际 Prompt 消息绑定，防止 Snapshot 选中内容和 Provider 内容漂移。 */
export interface TurnApplicationContextCandidate {
  segment: ContextSegment;
  message: ModelMessage;
  /** synthesis 可使用更严格的系统指令；省略时复用 answer 消息。 */
  synthesisMessage?: ModelMessage;
}

export type TurnApplicationContextMemory =
  | { status: 'unavailable'; reason: 'not_implemented' | 'disabled' }
  | {
      status: 'available';
      version: string;
      candidates: readonly TurnApplicationContextCandidate[];
    };

/** 只包含已由可信仓储完成 Actor/Notebook 过滤的 Context 候选。 */
export interface TurnApplicationContextPlan {
  profileVersion: string;
  profile: readonly TurnApplicationContextCandidate[];
  conversation: readonly TurnApplicationContextCandidate[];
  sourcesAndAssets: readonly TurnApplicationContextCandidate[];
  memory: TurnApplicationContextMemory;
  maxSegments?: number;
  maxCharacters?: number;
}

export interface TurnApplicationToolPolicy extends ToolKernelPolicyContext {
  channel: string;
  environment: string;
  profileContext?: Readonly<Record<string, unknown>>;
  credentialHandle?: string | null;
}

export interface TurnApplicationProfilePlan {
  context: TurnApplicationContextPlan;
  model: {
    taskAlias: StreamingTaskAlias;
    modelAlias: 'primary' | 'fast';
    promptVersion: string;
    synthesisPromptVersion?: string;
    maxToolRounds: number;
    /** Q03：本 Profile 的 Turn 使用预算（服务端冻结）；省略表示不执行预算。 */
    usageBudget?: TurnUsageBudget;
  };
  /** 省略表示该 Profile 此轮不暴露任何 Tool。 */
  toolPolicy?: TurnApplicationToolPolicy;
}

export type TurnApplicationPreflightDecision =
  | { kind: 'allow' }
  | {
      kind: 'reject';
      /** 面向当前用户的固定安全回应；不得包含 detector payload 或内部规则。 */
      publicContent: string;
      failureCode: TurnApplicationFailureCode;
    };

export type TurnApplicationOutputGuardPushResult =
  | { kind: 'hold' }
  | { kind: 'emit'; safeDeltas: readonly string[] }
  | {
      kind: 'block';
      /** 替代被拦截正文的固定安全回应。 */
      publicContent: string;
      failureCode: TurnApplicationFailureCode;
    };

export type TurnApplicationOutputGuardFinishResult = Exclude<
  TurnApplicationOutputGuardPushResult,
  { kind: 'hold' }
>;

/**
 * Provider delta 与公开事件之间的 Profile 安全闸门。实现必须有界缓存；一旦
 * 返回 block，后续正文不会再公开，Turn Application 会中止当前模型运行。
 */
export interface TurnApplicationOutputGuardPort {
  push(delta: string): Promise<TurnApplicationOutputGuardPushResult>;
  finish(): Promise<TurnApplicationOutputGuardFinishResult>;
}

export interface TurnApplicationProfilePort {
  /** 在任何 Context、Model Run 或 Tool 副作用前执行确定性输入策略。 */
  preflight?(input: {
    command: TurnApplicationCommand;
    turn: TurnApplicationLifecycleSnapshot;
  }): Promise<TurnApplicationPreflightDecision>;
  /** Profile 只装配 Context/Prompt/Policy，不得创建第二个模型循环。 */
  prepare(input: {
    command: TurnApplicationCommand;
    turn: TurnApplicationLifecycleSnapshot;
  }): Promise<TurnApplicationProfilePlan>;
  /**
   * 确定性领域服务在消息终态前最后复核答案并提交领域事实；不能返回 Turn 终态。
   */
  finalize?(input: {
    command: TurnApplicationCommand;
    turn: TurnApplicationLifecycleSnapshot;
    content: string;
  }): Promise<{
    content?: string;
    citationMarkers?: readonly number[];
    events?: readonly TurnApplicationProfileEvent[];
  }>;
  /** 每个新 Turn 返回独立的有状态输出闸门；replay 不会重新执行。 */
  createOutputGuard?(input: {
    command: TurnApplicationCommand;
    turn: TurnApplicationLifecycleSnapshot;
  }): TurnApplicationOutputGuardPort;
}

export interface TurnApplicationCancellationHandle {
  signal?: ModelAbortSignal;
  isCancellationRequested(): Promise<boolean>;
  close(): Promise<void> | void;
}

/** M4 可替换为 PostgreSQL lease/heartbeat；当前接口禁止只依赖进程内 AbortController。 */
export interface TurnApplicationCancellationPort {
  open(input: {
    operationId: string;
    actorId: string;
  }): Promise<TurnApplicationCancellationHandle>;
}

/** Turn span只导出可空W3C carrier；它是观测元数据，不得充当业务Trace或授权。 */
export interface TurnApplicationTraceSpan {
  carrier(): W3cTraceCarrier | null;
  event(name: string, attributes?: Readonly<Record<string, string>>): void;
  end(status: 'completed' | 'failed' | 'cancelled' | 'suspended'): void;
}

/** Trace 只接受白名单标识与阶段，不接受正文、Prompt、Tool 参数或 Secret。 */
export interface TurnApplicationTracePort {
  start(input: {
    operationId: string;
    traceId: string;
    actorId: string;
    agentId: string;
    notebookId: string;
    conversationId: string;
    profileId: string;
    entrypoint: TurnApplicationCommand['entrypoint'];
  }): TurnApplicationTraceSpan;
}

/**
 * Tool Kernel 的抽象 Port（R 线 R06）。
 *
 * Turn Application 只依赖此接口，不依赖具体 `ToolKernel` 类。
 * 具体实现（`ToolKernel`）在 agent-runtime 内部，生产装配点
 * （Web General/Teaching、Gateway）通过本接口注入已装配的 Kernel。
 * 这保证 Turn Application 组合契约不含具体 runtime 类。
 */
export interface ToolKernelPort {
  /** 按工具名查找对应的 capability 标识；未注册返回 null。 */
  capabilityFor(tool: string): string | null;

  /** 根据策略上下文返回当前 Profile 允许暴露给模型的工具定义列表。 */
  listDefinitions(
    context: ToolKernelPolicyContext,
  ): readonly ModelToolDefinition[];

  /** 执行单次工具调用；幂等、策略、审批全部在 Kernel 内部处理。 */
  execute(request: ToolKernelExecuteRequest): Promise<ToolKernelResult>;
}
