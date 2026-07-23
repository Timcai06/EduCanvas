/**
 * Turn Application 的兼容入口。
 *
 * 唯一的模型循环与 Turn 编排实现已按职责拆分到 `./turn-application/` 目录：
 * `ports`（公开 Port 与类型）、`model-run-lifecycle`（Model Run 审计）、
 * `helpers`（纯辅助与 Trace/Cancellation 默认实现）与 `service`（主编排）。
 * 本文件仅保留向后兼容的 re-export，公共导出与拆分前完全一致。
 * 新代码应直接从 `@educanvas/agent-runtime` 包入口导入。
 */

export { TurnApplicationService } from './turn-application/service';
export type {
  TurnApplicationCancellationHandle,
  TurnApplicationCancellationPort,
  TurnApplicationContextCandidate,
  TurnApplicationContextMemory,
  TurnApplicationContextPlan,
  TurnApplicationLifecyclePort,
  TurnApplicationLifecycleSnapshot,
  TurnApplicationOutputGuardFinishResult,
  TurnApplicationOutputGuardPort,
  TurnApplicationOutputGuardPushResult,
  TurnApplicationPort,
  TurnApplicationPreflightDecision,
  TurnApplicationProfileEvent,
  TurnApplicationProfilePlan,
  TurnApplicationProfilePort,
  TurnApplicationToolPolicy,
  TurnApplicationTracePort,
  TurnApplicationTraceSpan,
} from './turn-application/ports';
