import { z } from 'zod';

export const agentToolCallStatuses = [
  'pending',
  'running',
  'succeeded',
  'rejected',
  'failed',
  'outcome_unknown',
] as const;
export const agentToolCallStatusSchema = z.enum(agentToolCallStatuses);
export type AgentToolCallStatus = z.infer<typeof agentToolCallStatusSchema>;
export type AgentToolCallTerminalStatus = Extract<
  AgentToolCallStatus,
  'succeeded' | 'rejected' | 'failed' | 'outcome_unknown'
>;
export const agentToolExposureSchema = z.enum(['model', 'runtime']);
export type AgentToolExposure = z.infer<typeof agentToolExposureSchema>;
export const agentToolEffectSchema = z.enum(['read', 'write']);
export type AgentToolEffect = z.infer<typeof agentToolEffectSchema>;

/** 原始工具值的不可逆审计摘要；不得增加键名、值、异常或堆栈字段。 */
export interface AgentToolAuditValueSummary {
  schemaVersion: '1';
  kind:
    'null' | 'array' | 'object' | 'string' | 'number' | 'boolean' | 'undefined';
  byteLength: number;
  itemCount: number | null;
  sha256: string;
}

/** 通用 Turn 的脱敏 Tool Call 快照；只表达调用审计，不代表副作用已提交。 */
export interface AgentToolCallSnapshot {
  id: string;
  operationId: string;
  answerModelRunId: string;
  providerToolCallId: string;
  executionId: string;
  traceId: string;
  toolName: string | null;
  exposure: AgentToolExposure | null;
  effect: AgentToolEffect | null;
  argumentSummary: AgentToolAuditValueSummary;
  resultSummary: AgentToolAuditValueSummary | null;
  status: AgentToolCallStatus;
  code: string | null;
  retryable: boolean;
  durationMs: number | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface CreateAgentToolCallInput {
  operationId: string;
  /** Gateway/服务端解析出的 Actor ID，仓储必须重新验证归属。 */
  actorId: string;
  answerModelRunId: string;
  providerToolCallId: string;
  /** 由受信任Runtime生成，不采信模型参数。 */
  executionId: string;
  toolName: string | null;
  exposure: AgentToolExposure | null;
  effect: AgentToolEffect | null;
  arguments: unknown;
}

/**
 * Turn Application 使用的 Tool Call Ledger Port。
 * 实现必须同时以 executionId 与 ModelRun/providerCallId 幂等，并在每次生命周期更新时重验Actor。
 */
export interface AgentToolCallLedgerPort {
  createOrGet(
    input: CreateAgentToolCallInput,
  ): Promise<{ call: AgentToolCallSnapshot; replayed: boolean }>;
  markRunning(input: {
    operationId: string;
    actorId: string;
    toolCallId: string;
  }): Promise<{ call: AgentToolCallSnapshot; transitioned: boolean }>;
  settle(input: {
    operationId: string;
    actorId: string;
    toolCallId: string;
    status: AgentToolCallTerminalStatus;
    code?: string | null;
    retryable?: boolean;
    durationMs: number;
    result?: unknown;
  }): Promise<{ call: AgentToolCallSnapshot; transitioned: boolean }>;
  listByOperation(input: {
    operationId: string;
    actorId: string;
  }): Promise<readonly AgentToolCallSnapshot[]>;
}
