import type {
  AgentToolCallLedgerPort,
  ToolEffectLedgerPort,
} from '@educanvas/agent-core';
import {
  assertValidAdapter,
  listAllowedDefinitions,
  policyDenial,
} from './adapter-policy';
import type {
  AnyToolKernelAdapter,
  ToolKernelExecuteRequest,
  ToolKernelPolicyContext,
  ToolKernelResult,
} from './contracts';
import { executeToolLifecycle } from './lifecycle';
import { toolFailure } from './result';
import { createToolSemanticsHash } from './semantics';

interface CachedExecution {
  signature: string;
  result: Promise<ToolKernelResult>;
  settled: boolean;
}

/**
 * Tool Kernel — 工具调用的唯一入口。
 *
 * ## 职责边界
 *
 * Kernel 不执行工具 — Adapter 执行。Kernel 负责：
 * 1. **注册** — 启动时装载所有 Adapter，拒绝重复名称
 * 2. **授权** — 根据 ToolKernelPolicyContext 检查每个 Adapter 的策略允许
 * 3. **幂等** — 同一 executionId 的重复请求返回缓存结果（签名匹配）或拒绝（签名冲突）
 * 4. **路由** — L0/L1 直接 invoke，L2/L3 未审批时走 prepareApproval 流程
 *
 * ## execute() 流程
 *
 * ```
 * 查找 Adapter → 策略检查 → 参数校验 → 幂等检查 → 创建 Tool Call → 路由
 *                                                                   ├─ L2/L3 未审批 → prepareApproval
 *                                                                   └─ 其他 → invoke
 * ```
 *
 * ## 幂等缓存
 *
 * 每个 executionId 缓存一次执行结果。重复请求：
 * - 签名匹配 → 返回缓存结果（replayed=true）
 * - 签名不匹配 → 拒绝（idempotency_conflict）
 * - 达到 maxCachedExecutions → 驱逐最早已 settled 的条目
 */
export class ToolKernel {
  private readonly adapters = new Map<string, AnyToolKernelAdapter>();
  private readonly executions = new Map<string, CachedExecution>();

  constructor(
    adapters: readonly AnyToolKernelAdapter[],
    private readonly callLedger: AgentToolCallLedgerPort,
    private readonly effectLedger: ToolEffectLedgerPort,
    private readonly maxCachedExecutions = 1_024,
    private readonly now: () => Date = () => new Date(),
  ) {
    if (
      !Number.isSafeInteger(maxCachedExecutions) ||
      maxCachedExecutions < 1 ||
      maxCachedExecutions > 100_000
    ) {
      throw new Error('maxCachedExecutions必须是1到100000之间的整数');
    }
    for (const adapter of adapters) {
      assertValidAdapter(adapter, this.adapters.has(adapter.name));
      this.adapters.set(adapter.name, adapter);
    }
  }

  listDefinitions(context: ToolKernelPolicyContext) {
    return listAllowedDefinitions(this.adapters.values(), context);
  }

  capabilityFor(tool: string): string | null {
    return this.adapters.get(tool)?.capability ?? null;
  }

  async execute(request: ToolKernelExecuteRequest): Promise<ToolKernelResult> {
    const adapter = this.adapters.get(request.tool);
    if (!adapter) {
      return toolFailure(request.tool, 'denied', 'tool_not_available', false);
    }
    const denied = policyDenial(adapter, request.context);
    if (denied) return denied;
    const parsedInput = adapter.inputSchema.safeParse(request.arguments);
    if (!parsedInput.success) {
      return toolFailure(adapter.name, 'denied', 'invalid_arguments', false);
    }
    let signature: string;
    try {
      signature = createToolSemanticsHash(adapter, request);
    } catch {
      return toolFailure(adapter.name, 'denied', 'invalid_arguments', false);
    }
    const cached = this.executions.get(request.context.executionId);
    if (cached) {
      if (cached.signature !== signature) {
        return toolFailure(
          adapter.name,
          'denied',
          'idempotency_conflict',
          false,
        );
      }
      return { ...(await cached.result), replayed: true };
    }
    const capacityFailure = this.ensureCacheCapacity(adapter.name);
    if (capacityFailure) return capacityFailure;
    const entry: CachedExecution = {
      signature,
      result: Promise.resolve(
        toolFailure(adapter.name, 'failed', 'ledger_unavailable', true),
      ),
      settled: false,
    };
    entry.result = executeToolLifecycle({
      adapter,
      parsedInput: parsedInput.data as never,
      request,
      semanticsHash: signature,
      callLedger: this.callLedger,
      effectLedger: this.effectLedger,
      now: this.now,
    })
      .catch((error: unknown) => {
        const conflict =
          (error as { code?: unknown }).code === 'agent_tool_call_conflict';
        return toolFailure(
          adapter.name,
          conflict ? 'denied' : 'failed',
          conflict ? 'idempotency_conflict' : 'ledger_unavailable',
          !conflict,
        );
      })
      .finally(() => {
        entry.settled = true;
      });
    this.executions.set(request.context.executionId, entry);
    return entry.result;
  }

  private ensureCacheCapacity(tool: string): ToolKernelResult | null {
    if (this.executions.size < this.maxCachedExecutions) return null;
    const settled = [...this.executions].find(([, value]) => value.settled);
    if (!settled) {
      return toolFailure(tool, 'failed', 'execution_cache_capacity', true);
    }
    this.executions.delete(settled[0]);
    return null;
  }
}
