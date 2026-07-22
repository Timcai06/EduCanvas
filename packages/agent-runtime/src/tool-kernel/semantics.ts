import { createHash } from 'node:crypto';
import type {
  AnyToolKernelAdapter,
  ToolKernelExecuteRequest,
} from './contracts';

function canonicalize(value: unknown, seen = new WeakSet<object>()): string {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? JSON.stringify(value) : '"[non-finite]"';
  }
  if (typeof value === 'undefined') return '"[undefined]"';
  if (typeof value !== 'object') return `"[${typeof value}]"`;
  if (seen.has(value)) throw new Error('circular_tool_value');
  seen.add(value);
  const result = Array.isArray(value)
    ? `[${value.map((item) => canonicalize(item, seen)).join(',')}]`
    : `{${Object.keys(value as Record<string, unknown>)
        .sort()
        .map(
          (key) =>
            `${JSON.stringify(key)}:${canonicalize((value as Record<string, unknown>)[key], seen)}`,
        )
        .join(',')}}`;
  seen.delete(value);
  return result;
}

/** @internal 生成幂等语义摘要；原始参数不得进入持久effect ledger。 */
export function createToolSemanticsHash(
  adapter: AnyToolKernelAdapter,
  request: ToolKernelExecuteRequest,
): string {
  const semantics: unknown[] = [
    adapter.name,
    request.arguments,
    request.context.operationId,
    request.context.conversationId,
    request.context.traceId,
    request.context.actorId,
    request.context.agentId,
    request.context.notebookId,
    request.context.answerModelRunId,
    request.context.providerToolCallId,
  ];
  if (adapter.reconciliationVerifierId != null) {
    semantics.push({
      reconciliationVerifierId: adapter.reconciliationVerifierId,
    });
  }
  return createHash('sha256').update(canonicalize(semantics)).digest('hex');
}
