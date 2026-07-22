import type { ModelToolDefinition } from '@educanvas/agent-core';
import { z } from 'zod';
import {
  toolPolicyDimensions,
  toolRiskLevels,
  toolSources,
  type AnyToolKernelAdapter,
  type ToolKernelPolicyContext,
  type ToolKernelResult,
} from './contracts';
import { toolFailure } from './result';

/** @internal 构造期验证服务端Adapter元数据并拒绝重复注册。 */
export function assertValidAdapter(
  adapter: AnyToolKernelAdapter,
  duplicate: boolean,
): void {
  if (
    !/^[a-z][A-Za-z0-9_.-]{0,63}$/.test(adapter.name) ||
    !/^[a-z][a-z0-9_.-]{0,63}$/.test(adapter.capability) ||
    !toolSources.includes(adapter.source) ||
    !toolRiskLevels.includes(adapter.risk) ||
    !['model', 'runtime'].includes(adapter.exposure) ||
    !['read', 'write'].includes(adapter.effect) ||
    !Number.isSafeInteger(adapter.timeoutMs) ||
    adapter.timeoutMs < 1 ||
    adapter.timeoutMs > 10 * 60_000 ||
    duplicate
  ) {
    throw new Error(`非法或重复Tool Adapter: ${adapter.name}`);
  }
}

/** @internal 按固定顺序计算五维权限交集，任一维缺失即fail closed。 */
export function policyDenial(
  adapter: AnyToolKernelAdapter,
  context: ToolKernelPolicyContext,
): ToolKernelResult | null {
  const denied = toolPolicyDimensions.find(
    (dimension) =>
      !context.capabilities[dimension].includes(adapter.capability),
  );
  return denied
    ? toolFailure(adapter.name, 'denied', `capability_denied:${denied}`, false)
    : null;
}

/** @internal 只向模型暴露通过权限交集且标记为model的定义。 */
export function listAllowedDefinitions(
  adapters: Iterable<AnyToolKernelAdapter>,
  context: ToolKernelPolicyContext,
): readonly ModelToolDefinition[] {
  return [...adapters]
    .filter(
      (adapter) =>
        adapter.exposure === 'model' &&
        !toolPolicyDimensions.some(
          (dimension) =>
            !context.capabilities[dimension].includes(adapter.capability),
        ),
    )
    .sort((left, right) => (left.name < right.name ? -1 : 1))
    .map((adapter) => ({
      name: adapter.name,
      description: adapter.description,
      inputSchema:
        adapter.modelInputSchema ??
        (z.toJSONSchema(adapter.inputSchema) as Record<string, unknown>),
    }));
}
