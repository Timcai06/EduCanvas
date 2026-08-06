import type {
  AgentModelRunLedgerPort,
  AgentTurnContextLedgerPort,
  TurnModelGateway,
  TurnUsageBudgetLedgerPort,
} from '@educanvas/agent-core';
import type {
  TurnApplicationCancellationPort,
  TurnApplicationLifecyclePort,
  TurnApplicationProfilePort,
  TurnApplicationTracePort,
  ToolKernelPort,
} from './ports';

/**
 * Turn Application 的唯一组合契约（R 线 R06）。
 *
 * 三个生产入口（Web General、Web Teaching、Gateway）统一经 `createTurnApplication`
 * 注入全部 Ports，不再各自 `new TurnApplicationService`。本接口只含抽象 Port 类型，
 * 不得加入 Transport 或数据库实现类型；新增依赖必须同时更新本接口与全部生产装配点。
 */
export interface TurnApplicationDependencies {
  lifecycle: TurnApplicationLifecyclePort;
  profile: TurnApplicationProfilePort;
  contextLedger: AgentTurnContextLedgerPort;
  modelRunLedger: AgentModelRunLedgerPort;
  modelGateway: TurnModelGateway;
  toolKernel?: ToolKernelPort;
  cancellation?: TurnApplicationCancellationPort;
  trace?: TurnApplicationTracePort;
  /** Q03：Turn 使用预算账本；省略表示不落账（组合根应始终注入）。 */
  usageBudgetLedger?: TurnUsageBudgetLedgerPort;
}
