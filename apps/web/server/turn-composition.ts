/**
 * Web Turn 公共组合层（R 线 R06）。
 *
 * Web General 与 Web Teaching 两条入口共享的 Drizzle 账本、Trace
 * 与 ToolKernel 装配。本模块是唯一可以直接实例化 Drizzle Repository
 * 与 ToolKernel 的 Web 组合点；入口只提供 identity、profile、transport、
 * capability 与领域 adapter 差异。
 *
 * Gateway 入口使用 apps/gateway/src/turn-composition.ts 中的
 * createGatewayDependencies()，其装配与本模块共享同一 ToolKernelPort 契约。
 */
import 'server-only';

import type { TurnModelGateway } from '@educanvas/agent-core';
import type {
  ToolKernelAdapter,
  ToolKernelPort,
  TurnApplicationTracePort,
} from '@educanvas/agent-runtime';
import { ToolKernel } from '@educanvas/agent-runtime';
import {
  DrizzleAgentModelRunRepository,
  DrizzleAgentToolCallRepository,
  DrizzleAgentTurnContextRepository,
  DrizzleToolEffectRepository,
} from '@educanvas/db';
import { getWebTelemetryRuntime } from './telemetry/telemetry-runtime';

/** 模型网关不可用时的诚实失败桩，不伪造空能力成功。 */
export const unavailableModelGateway: TurnModelGateway = {
  async *streamTurnText(request) {
    yield {
      type: 'failed',
      phase: request.phase,
      error: { code: 'unavailable', retryable: true },
    };
  },
};

/**
 * 创建 Web Turn 公共的 Drizzle 账本与 Trace。
 * 两条入口不得各自 `new DrizzleAgent*Repository()`；
 * 唯一构造点在本函数与 Gateway 的 createGatewayDependencies()。
 */
export function createWebTurnLedgers(): {
  contextLedger: DrizzleAgentTurnContextRepository;
  modelRunLedger: DrizzleAgentModelRunRepository;
  trace: TurnApplicationTracePort;
} {
  return {
    contextLedger: new DrizzleAgentTurnContextRepository(),
    modelRunLedger: new DrizzleAgentModelRunRepository(),
    trace: getWebTelemetryRuntime().turnTrace,
  };
}

/**
 * 从 Adapter 列表创建 ToolKernel（统一走 Drizzle 持久化）。
 * 两条入口不得各自 `new ToolKernel(...)` 或绕开本工厂直连 Drizzle。
 */
export function createWebToolKernel(
  adapters: ReadonlyArray<ToolKernelAdapter>,
): ToolKernelPort {
  return new ToolKernel(
    adapters,
    new DrizzleAgentToolCallRepository(),
    new DrizzleToolEffectRepository(),
  );
}
