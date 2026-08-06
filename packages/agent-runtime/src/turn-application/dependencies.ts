import type {
  AgentModelRunLedgerPort,
  AgentTurnContextLedgerPort,
  TurnModelGateway,
  TurnUsageBudgetLedgerPort,
} from '@educanvas/agent-core';
import type { ToolKernel } from '../tool-kernel';
import type {
  TurnApplicationCancellationPort,
  TurnApplicationLifecyclePort,
  TurnApplicationProfilePort,
  TurnApplicationTracePort,
} from './ports';

/** @internal 唯一Turn组合根可注入的Ports；不得加入Transport或数据库实现类型。 */
export interface TurnApplicationDependencies {
  lifecycle: TurnApplicationLifecyclePort;
  profile: TurnApplicationProfilePort;
  contextLedger: AgentTurnContextLedgerPort;
  modelRunLedger: AgentModelRunLedgerPort;
  modelGateway: TurnModelGateway;
  toolKernel?: ToolKernel;
  cancellation?: TurnApplicationCancellationPort;
  trace?: TurnApplicationTracePort;
  /** Q03：Turn 使用预算账本；省略表示不落账（组合根应始终注入）。 */
  usageBudgetLedger?: TurnUsageBudgetLedgerPort;
}
