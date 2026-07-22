import type {
  TurnApplicationCommand,
  TurnApplicationFailureCode,
  W3cTraceCarrier,
} from '@educanvas/agent-core';
import type { AgentLoopToolBatch, AgentLoopToolSuccess } from '../agent-loop';
import type { ParsedToolCall } from '../turn-engine';
import type { ToolKernel, ToolKernelTrustedContext } from '../tool-kernel';
import { executionId, mapToolFailure } from './helpers';
import type { ModelRunContext } from './model-run-lifecycle';
import type { TurnApplicationToolPolicy } from './ports';

export interface TurnToolDetail {
  executionId: string;
}

export interface TurnToolFailure {
  executionId: string;
  tool: string;
  code: TurnApplicationFailureCode;
  retryable: boolean;
  approval?: {
    approvalId: string;
    capability: string;
    risk: 'l2' | 'l3';
    summary: string;
    expiresAt: string;
  };
}

interface ToolBatchContext {
  round: number;
  traceId: string;
  turnId: string;
  modelRun: ModelRunContext | undefined;
}

/** @internal 将Agent Loop的调用批次绑定到可信Tool Kernel上下文与稳定executionId。 */
export class TurnToolExecutor {
  private readonly callIds = new Map<string, string>();

  constructor(
    private readonly command: TurnApplicationCommand,
    private readonly policy: TurnApplicationToolPolicy | undefined,
    private readonly toolKernel: ToolKernel | undefined,
    private readonly signal: AbortSignal,
    private readonly traceCarrier: W3cTraceCarrier | null,
  ) {}

  register(run: number, call: ParsedToolCall): string {
    const id = executionId(this.command.operationId, run, call.callId);
    this.callIds.set(`${run}:${call.callId}`, id);
    return id;
  }

  capabilityFor(tool: string): string {
    return this.toolKernel?.capabilityFor(tool) ?? 'tool.unknown';
  }

  async execute(
    calls: readonly ParsedToolCall[],
    context: ToolBatchContext,
  ): Promise<AgentLoopToolBatch<TurnToolDetail, TurnToolFailure>> {
    if (!context.modelRun || !this.policy || !this.toolKernel) {
      const call = calls[0]!;
      return {
        ok: false,
        failure: {
          executionId:
            this.callIds.get(`${context.round}:${call.callId}`) ??
            this.command.operationId,
          tool: call.tool,
          code: 'CAPABILITY_UNAVAILABLE',
          retryable: false,
        },
      };
    }
    const results: AgentLoopToolSuccess<TurnToolDetail>[] = [];
    for (const call of calls) {
      const id = this.callIds.get(`${context.round}:${call.callId}`);
      if (!id) {
        return {
          ok: false,
          failure: {
            executionId: this.command.operationId,
            tool: call.tool,
            code: 'RUNTIME_FAILED',
            retryable: false,
          },
        };
      }
      const trusted: ToolKernelTrustedContext = {
        operationId: this.command.operationId,
        conversationId: this.command.notebook.conversationId,
        traceId: this.command.traceId,
        actorId: this.command.actor.actorId,
        agentId: this.command.actor.agentId,
        notebookId: this.command.notebook.notebookId,
        profileId: this.command.profile.profileId,
        channel: this.policy.channel,
        environment: this.policy.environment,
        answerModelRunId: context.modelRun.runId,
        providerToolCallId: call.callId,
        executionId: id,
        capabilities: this.policy.capabilities,
        approvedCapabilities: this.policy.approvedCapabilities,
        profileContext: this.policy.profileContext,
        credentialHandle: this.policy.credentialHandle,
      };
      const executed = await this.toolKernel.execute({
        tool: call.tool,
        arguments: call.arguments,
        context: trusted,
        traceCarrier: this.traceCarrier,
        signal: this.signal,
      });
      if (!executed.ok) {
        return {
          ok: false,
          failure: {
            executionId: id,
            tool: call.tool,
            code: mapToolFailure(executed.code),
            retryable: executed.retryable,
            ...(executed.status === 'approval_required'
              ? {
                  approval: {
                    approvalId: executed.approval.approvalId,
                    capability: executed.approval.capability,
                    risk: executed.approval.risk,
                    summary: executed.approval.summary,
                    expiresAt: executed.approval.expiresAt,
                  },
                }
              : {}),
          },
        };
      }
      results.push({
        call,
        modelResult: {
          callId: call.callId,
          tool: call.tool,
          arguments: call.arguments,
          output: executed.output,
        },
        detail: { executionId: id },
      });
    }
    return { ok: true, results };
  }
}
