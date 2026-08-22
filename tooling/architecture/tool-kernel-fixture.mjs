const TOOL_NAME_PATTERN = /^[a-z][a-z0-9_.-]{0,63}$/;
const TOOL_SOURCES = new Set(['local', 'teaching', 'mcp', 'node']);
const TOOL_EFFECTS = new Set(['read', 'write']);
const TOOL_RISKS = new Set(['l0', 'l1', 'l2', 'l3']);
const POLICY_DIMENSIONS = [
  'actor',
  'notebook',
  'profile',
  'channel',
  'environment',
];

class ToolTimeoutError extends Error {}
class ToolCancelledError extends Error {}

const canonicalize = (value) => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item)).join(',')}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`)
    .join(',')}}`;
};

const failure = (status, code, retryable, replayed = false) => ({
  ok: false,
  status,
  code,
  retryable,
  replayed,
});

/**
 * 创建研究夹具使用的 provider-neutral Tool Adapter 描述。
 * Adapter 只声明来源和能力，不拥有 Actor、Notebook、审批或幂等判定权。
 */
export const defineFixtureTool = (definition) => {
  if (!TOOL_NAME_PATTERN.test(definition.name)) {
    throw new Error('invalid_tool_name');
  }
  if (!TOOL_SOURCES.has(definition.source)) {
    throw new Error('invalid_tool_source');
  }
  if (!TOOL_EFFECTS.has(definition.effect)) {
    throw new Error('invalid_tool_effect');
  }
  if (!TOOL_RISKS.has(definition.risk)) {
    throw new Error('invalid_tool_risk');
  }
  if (
    !Number.isSafeInteger(definition.timeoutMs) ||
    definition.timeoutMs <= 0
  ) {
    throw new Error('invalid_tool_timeout');
  }
  return Object.freeze({ ...definition });
};

/**
 * 第二代 Tool Kernel 的研究性语义夹具，不是生产 Runtime。
 * 它用于证明四类 Adapter 能共享同一权限交集、审批、effect ledger 与失败终态。
 */
export class ToolKernelFixture {
  #tools = new Map();
  #executions = new Map();
  #ledger = [];

  constructor(tools) {
    for (const tool of tools) {
      if (this.#tools.has(tool.name)) throw new Error('duplicate_tool');
      this.#tools.set(tool.name, tool);
    }
  }

  listLedger() {
    return this.#ledger.map((entry) => ({ ...entry }));
  }

  async execute(request) {
    const tool = this.#tools.get(request.tool);
    if (!tool) return failure('denied', 'tool_not_available', false);

    const signature = canonicalize([
      request.tool,
      request.arguments,
      request.context.operationId,
      request.context.actorId,
      request.context.agentId,
      request.context.notebookId,
    ]);
    const cached = this.#executions.get(request.context.executionId);
    if (cached) {
      if (cached.signature !== signature) {
        return failure('denied', 'idempotency_conflict', false);
      }
      return { ...(await cached.result), replayed: true };
    }

    const deniedDimension = POLICY_DIMENSIONS.find(
      (dimension) =>
        !request.context.capabilities[dimension]?.includes(tool.capability),
    );
    if (deniedDimension) {
      return failure('denied', `capability_denied:${deniedDimension}`, false);
    }

    if (
      (tool.risk === 'l2' || tool.risk === 'l3') &&
      !request.context.approvedCapabilities.includes(tool.capability)
    ) {
      return failure('approval_required', 'approval_required', false);
    }

    const invocation = this.#invoke(tool, request);
    this.#executions.set(request.context.executionId, {
      signature,
      result: invocation,
    });
    return invocation;
  }

  async #invoke(tool, request) {
    const baseEntry = {
      executionId: request.context.executionId,
      operationId: request.context.operationId,
      tool: tool.name,
      source: tool.source,
      effect: tool.effect,
    };
    this.#ledger.push({ ...baseEntry, status: 'intended' });

    const controller = new AbortController();
    let timer;
    let removeExternalAbort = () => undefined;
    let rejectCancellation = () => undefined;

    const cancellation = new Promise((_, reject) => {
      rejectCancellation = reject;
    });
    const cancel = () => {
      controller.abort('cancelled');
      rejectCancellation(new ToolCancelledError());
    };
    if (request.signal?.aborted) cancel();
    else if (request.signal) {
      request.signal.addEventListener('abort', cancel, { once: true });
      removeExternalAbort = () =>
        request.signal.removeEventListener('abort', cancel);
    }

    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort('timeout');
        reject(new ToolTimeoutError());
      }, tool.timeoutMs);
    });

    try {
      const output = await Promise.race([
        tool.invoke(request.arguments, {
          signal: controller.signal,
          operationId: request.context.operationId,
          actorId: request.context.actorId,
          agentId: request.context.agentId,
          notebookId: request.context.notebookId,
        }),
        timeout,
        cancellation,
      ]);
      this.#ledger.push({ ...baseEntry, status: 'committed' });
      return {
        ok: true,
        status: 'succeeded',
        output,
        replayed: false,
      };
    } catch (error) {
      if (
        tool.effect === 'write' &&
        (error instanceof ToolTimeoutError ||
          error instanceof ToolCancelledError)
      ) {
        this.#ledger.push({ ...baseEntry, status: 'outcome_unknown' });
        return failure('outcome_unknown', 'write_outcome_unknown', false);
      }
      if (error instanceof ToolTimeoutError) {
        this.#ledger.push({ ...baseEntry, status: 'timed_out' });
        return failure('timed_out', 'tool_timeout', true);
      }
      if (error instanceof ToolCancelledError) {
        this.#ledger.push({ ...baseEntry, status: 'cancelled' });
        return failure('cancelled', 'tool_cancelled', true);
      }
      this.#ledger.push({ ...baseEntry, status: 'failed' });
      return failure('failed', 'tool_failed', false);
    } finally {
      clearTimeout(timer);
      removeExternalAbort();
    }
  }
}
