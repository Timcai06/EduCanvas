import { z } from 'zod';
import type {
  ModelAlias,
  ModelFinishReason,
  ModelUsage,
  StreamingTaskAlias,
  TurnModelPhase,
} from './model-contracts';

export const agentModelRunStatuses = [
  'pending',
  'running',
  'succeeded',
  'failed',
  'cancelled',
  'interrupted',
] as const;
export const agentModelRunStatusSchema = z.enum(agentModelRunStatuses);
export type AgentModelRunStatus = z.infer<typeof agentModelRunStatusSchema>;
export type AgentModelRunTerminalStatus = Extract<
  AgentModelRunStatus,
  'succeeded' | 'failed' | 'cancelled' | 'interrupted'
>;

export interface AgentModelRunProviderResult {
  provider?: string | null;
  providerModelId?: string | null;
  modelRevision?: string | null;
  providerResponseId?: string | null;
  systemFingerprint?: string | null;
  finishReason?: ModelFinishReason | null;
  latencyMs?: number | null;
  usage?: ModelUsage;
}

/** 通用 Turn 的脱敏模型运行快照；不包含 Prompt、正文或供应商推理。 */
export interface AgentModelRunSnapshot {
  id: string;
  operationId: string;
  assistantMessageId: string;
  phase: TurnModelPhase;
  attempt: number;
  traceId: string;
  taskAlias: StreamingTaskAlias;
  modelAlias: ModelAlias;
  promptVersion: string;
  promptHash: string;
  provider: string | null;
  providerModelId: string | null;
  modelRevision: string | null;
  providerResponseId: string | null;
  systemFingerprint: string | null;
  finishReason: string | null;
  status: AgentModelRunStatus;
  errorCode: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheHitTokens: number | null;
  reasoningTokens: number | null;
  latencyMs: number | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface CreateAgentModelRunInput {
  operationId: string;
  /** Gateway/服务端解析出的 Actor ID，仓储必须重新验证归属。 */
  actorId: string;
  assistantMessageId: string;
  phase: TurnModelPhase;
  attempt?: number;
  /** 业务Profile的稳定任务别名；不得填写供应商模型ID。 */
  taskAlias: StreamingTaskAlias;
  modelAlias: ModelAlias;
  promptVersion: string;
  /** Prompt 的不可逆 SHA-256；Port 不接受 Prompt 正文。 */
  promptHash: string;
  provider?: string | null;
}

/**
 * Turn Application 使用的 Model Run Ledger Port。
 * 实现必须以 operation/phase/attempt 幂等，所有生命周期更新都重新验证 Actor 归属。
 */
export interface AgentModelRunLedgerPort {
  createOrGet(
    input: CreateAgentModelRunInput,
  ): Promise<{ run: AgentModelRunSnapshot; replayed: boolean }>;
  markRunning(input: {
    operationId: string;
    actorId: string;
    runId: string;
  }): Promise<{ run: AgentModelRunSnapshot; transitioned: boolean }>;
  settle(input: {
    operationId: string;
    actorId: string;
    runId: string;
    status: AgentModelRunTerminalStatus;
    errorCode?: string | null;
    providerResult?: AgentModelRunProviderResult;
  }): Promise<{ run: AgentModelRunSnapshot; transitioned: boolean }>;
  listByOperation(input: {
    operationId: string;
    actorId: string;
  }): Promise<readonly AgentModelRunSnapshot[]>;
}
