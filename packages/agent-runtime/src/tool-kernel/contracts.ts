/**
 * Tool Kernel 契约 — 四类 Adapter 注册模型与调用边界。
 *
 * ## 四类 Adapter 来源
 *
 * | 来源 | 信任边界 | 典型用途 |
 * |------|---------|---------|
 * | local | 进程内可信 | 数据库写入、文件操作 |
 * | teaching | 教学领域 | 检索知识、出题判分、Canvas 渲染 |
 * | mcp | MCP 协议远端 | 外部工具服务 |
 * | node | Capability Node | 受控只读文件能力 |
 *
 * ## 风险等级
 *
 * | 等级 | 含义 | 审批要求 |
 * |------|------|---------|
 * | l0 | 只读、无副作用 | 无需审批 |
 * | l1 | 写入、受控副作用 | 无需审批（策略允许即放行） |
 * | l2 | 高风险写入 | 需审批（approval_required），有 reconciliation |
 * | l3 | 最高风险 | 同 l2 + 更严格的 reconciliation 要求 |
 *
 * 风险等级由服务端 Adapter 注册时冻结，模型和远端协议都不得覆盖。
 */

import type {
  AgentToolEffect,
  AgentToolExposure,
  ModelAbortSignal,
  W3cTraceCarrier,
} from '@educanvas/agent-core';
import { type z } from 'zod';

/** Kernel允许注册的Adapter来源；来源只描述信任边界，不参与客户端选择。 */
export const toolSources = ['local', 'teaching', 'mcp', 'node'] as const;
export type ToolSource = (typeof toolSources)[number];
/** 风险等级由服务端Adapter注册冻结，模型与远端协议都不得覆盖。 */
export const toolRiskLevels = ['l0', 'l1', 'l2', 'l3'] as const;
export type ToolRiskLevel = (typeof toolRiskLevels)[number];
/** 工具授权必须通过的五个服务端可信维度。 */
export const toolPolicyDimensions = [
  'actor',
  'notebook',
  'profile',
  'channel',
  'environment',
] as const;
export type ToolPolicyDimension = (typeof toolPolicyDimensions)[number];

/** 单次工具调用的可信身份与幂等上下文；禁止从模型参数构造。 */
export interface ToolKernelTrustedContext {
  operationId: string;
  conversationId: string;
  traceId: string;
  actorId: string;
  agentId: string;
  notebookId: string;
  profileId: string;
  channel: string;
  environment: string;
  answerModelRunId: string;
  providerToolCallId: string;
  executionId: string;
  capabilities: Readonly<Record<ToolPolicyDimension, readonly string[]>>;
  approvedCapabilities: readonly string[];
  profileContext?: Readonly<Record<string, unknown>>;
  credentialHandle?: string | null;
}

/** Tool暴露阶段只读取授权交集，不得提前注入运行身份与调用ID。 */
export type ToolKernelPolicyContext = Pick<
  ToolKernelTrustedContext,
  'capabilities' | 'approvedCapabilities'
>;

/** Kernel投影给Adapter的最小可信上下文；signal是唯一取消通道。 */
export interface ToolAdapterInvocationContext {
  operationId: string;
  executionId: string;
  conversationId: string;
  traceId: string;
  actorId: string;
  agentId: string;
  notebookId: string;
  profileId: string;
  channel: string;
  environment: string;
  credentialHandle: string | null;
  profileContext: Readonly<Record<string, unknown>>;
  signal: AbortSignal;
}

/** L2/L3 Adapter写入自身耐久意图后返回的有界公开审批描述。 */
export interface ToolAdapterApprovalPreparation {
  approvalId: string;
  summary: string;
  expiresAt: string;
}

/** 审批准备可见已持久化Tool Call ID，用于绑定Adapter私有意图。 */
export interface ToolAdapterApprovalContext extends ToolAdapterInvocationContext {
  toolCallId: string;
  traceCarrier: W3cTraceCarrier | null;
}

/** Adapter声明能力与执行；身份、授权、审批、幂等和终态属于Kernel。 */
export interface ToolKernelAdapter<Input = unknown, Output = unknown> {
  name: string;
  description: string;
  source: ToolSource;
  capability: string;
  risk: ToolRiskLevel;
  exposure: AgentToolExposure;
  effect: AgentToolEffect;
  /** 仅write Adapter可声明的受信只读对账核验器；调用方不能覆盖。 */
  reconciliationVerifierId?: string | null;
  timeoutMs: number;
  inputSchema: z.ZodType<Input>;
  modelInputSchema?: Readonly<Record<string, unknown>>;
  outputSchema: z.ZodType<Output>;
  prepareApproval?(
    input: Input,
    context: ToolAdapterApprovalContext,
  ): Promise<ToolAdapterApprovalPreparation> | ToolAdapterApprovalPreparation;
  invoke(
    input: Input,
    context: ToolAdapterInvocationContext,
  ): Promise<Output> | Output;
}

/** @internal 异构Adapter注册表使用的类型擦除边界。 */
export interface AnyToolKernelAdapter {
  name: string;
  description: string;
  source: ToolSource;
  capability: string;
  risk: ToolRiskLevel;
  exposure: AgentToolExposure;
  effect: AgentToolEffect;
  reconciliationVerifierId?: string | null;
  timeoutMs: number;
  inputSchema: z.ZodType<unknown>;
  modelInputSchema?: Readonly<Record<string, unknown>>;
  outputSchema: z.ZodType<unknown>;
  prepareApproval?(
    input: never,
    context: ToolAdapterApprovalContext,
  ): Promise<ToolAdapterApprovalPreparation> | ToolAdapterApprovalPreparation;
  invoke(
    input: never,
    context: ToolAdapterInvocationContext,
  ): Promise<unknown> | unknown;
}

/** Kernel对调用方公开的稳定失败码；不得包含Adapter错误或原始参数。 */
export type ToolKernelFailureCode =
  | 'tool_not_available'
  | `capability_denied:${ToolPolicyDimension}`
  | 'approval_required'
  | 'approval_preparation_failed'
  | 'invalid_arguments'
  | 'idempotency_conflict'
  | 'execution_cache_capacity'
  | 'execution_in_progress'
  | 'result_replay_required'
  | 'tool_timeout'
  | 'tool_cancelled'
  | 'write_outcome_unknown'
  | 'tool_failed'
  | 'invalid_output'
  | 'ledger_unavailable';

/** Kernel唯一公开结果联合；审批挂起不是Operation失败终态。 */
export type ToolKernelResult =
  | {
      ok: true;
      status: 'succeeded';
      tool: string;
      output: unknown;
      replayed: boolean;
    }
  | {
      ok: false;
      status: 'approval_required';
      tool: string;
      code: 'approval_required';
      retryable: false;
      replayed: boolean;
      approval: {
        approvalId: string;
        toolCallId: string;
        capability: string;
        risk: 'l2' | 'l3';
        adapterSource: ToolSource;
        summary: string;
        expiresAt: string;
      };
    }
  | {
      ok: false;
      status:
        'denied' | 'timed_out' | 'cancelled' | 'failed' | 'outcome_unknown';
      tool: string;
      code: ToolKernelFailureCode;
      retryable: boolean;
      replayed: boolean;
    };

/** 单次执行请求；调用身份和executionId必须由可信组合根生成。 */
export interface ToolKernelExecuteRequest {
  tool: string;
  arguments: unknown;
  context: ToolKernelTrustedContext;
  /** 只在L2/L3审批意图准备时下传，不得投影到普通invoke上下文。 */
  traceCarrier?: W3cTraceCarrier | null;
  signal?: ModelAbortSignal;
}

/** write Adapter无法确认外部副作用结果时使用；message不得进入公共边界。 */
export class ToolOutcomeUnknownError extends Error {
  override readonly name = 'ToolOutcomeUnknownError';
}
