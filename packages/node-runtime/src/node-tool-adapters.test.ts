import type { ToolAdapterInvocationContext } from '@educanvas/agent-runtime';
import type {
  GatewayNodeInvocationRequest,
  GatewayNodeInvocationResult,
} from '@educanvas/gateway-core';
import { describe, expect, it, vi } from 'vitest';
import {
  createNodeToolAdapters,
  resolveAvailableNodeToolCapabilities,
  type NodeInvocationOutcome,
  type NodeInvocationPersistencePort,
} from './node-tool-adapters';

class MemoryNodeInvocations implements NodeInvocationPersistencePort {
  readonly enqueued: GatewayNodeInvocationRequest[] = [];
  readonly expired: string[] = [];
  capabilities = ['device.status'] as const;
  outcomes: NodeInvocationOutcome[] = [];

  async listAvailableCapabilitiesForOperation() {
    return this.capabilities;
  }

  async enqueueForOperation(
    input: Parameters<NodeInvocationPersistencePort['enqueueForOperation']>[0],
  ) {
    const request = {
      requestId: input.requestId,
      operationId: input.operationId,
      nodeId: 'private-node-id',
      capability: input.capability,
      parameters: input.parameters,
      nonce: input.nonce,
      issuedAt: input.issuedAt.toISOString(),
      expiresAt: input.expiresAt.toISOString(),
    } satisfies GatewayNodeInvocationRequest;
    this.enqueued.push(request);
    return request;
  }

  async readInvocationOutcome(): Promise<NodeInvocationOutcome> {
    return this.outcomes.shift() ?? { status: 'pending' };
  }

  async expirePendingInvocation(
    input: Parameters<
      NodeInvocationPersistencePort['expirePendingInvocation']
    >[0],
  ) {
    this.expired.push(input.requestId);
  }
}

const context = (signal: AbortSignal): ToolAdapterInvocationContext => ({
  operationId: 'operation:1',
  executionId: 'execution:1',
  conversationId: 'conversation:1',
  traceId: 'trace:1',
  actorId: 'actor:1',
  agentId: 'agent:1',
  notebookId: 'notebook:1',
  profileId: 'agent.general',
  channel: 'tui',
  environment: 'test',
  credentialHandle: null,
  profileContext: {},
  signal,
});

describe('Node Tool Kernel adapters', () => {
  it('只暴露协议允许的L0/L1只读能力', () => {
    const adapters = createNodeToolAdapters(new MemoryNodeInvocations());
    expect(
      adapters.map((adapter) => ({
        name: adapter.name,
        capability: adapter.capability,
        risk: adapter.risk,
        effect: adapter.effect,
        source: adapter.source,
      })),
    ).toEqual([
      {
        name: 'getDeviceStatus',
        capability: 'device.status',
        risk: 'l0',
        effect: 'read',
        source: 'node',
      },
      {
        name: 'readNodeFile',
        capability: 'filesystem.read_allowlisted',
        risk: 'l1',
        effect: 'read',
        source: 'node',
      },
    ]);
  });

  it('从Operation作用域入队并等待已结算结果，不向模型暴露nodeId', async () => {
    const persistence = new MemoryNodeInvocations();
    const completed: GatewayNodeInvocationResult = {
      requestId: 'ignored-by-fixture',
      nodeId: 'private-node-id',
      status: 'completed',
      completedAt: '2026-07-22T00:00:01.000Z',
      output: {
        platform: 'darwin',
        architecture: 'arm64',
        hostname: 'student-mac',
        uptimeSeconds: 42,
      },
    };
    persistence.outcomes.push({ status: 'settled', result: completed });
    const [adapter] = createNodeToolAdapters(persistence, {
      now: () => new Date('2026-07-22T00:00:00.000Z'),
      requestTtlMs: 1_000,
      adapterTimeoutMs: 1_000,
      pollIntervalMs: 10,
    });
    if (!adapter) throw new Error('device adapter missing');

    const output = await adapter.invoke(
      {} as never,
      context(new AbortController().signal),
    );

    expect(output).toEqual(completed.output);
    expect(persistence.enqueued).toHaveLength(1);
    expect(persistence.enqueued[0]).toMatchObject({
      operationId: 'operation:1',
      capability: 'device.status',
      parameters: {},
    });
    expect(JSON.stringify(output)).not.toContain('private-node-id');
  });

  it('取消等待时尽力把pending调用收敛为expired', async () => {
    const persistence = new MemoryNodeInvocations();
    const controller = new AbortController();
    const [adapter] = createNodeToolAdapters(persistence, {
      requestTtlMs: 1_000,
      adapterTimeoutMs: 1_000,
      pollIntervalMs: 10,
    });
    if (!adapter) throw new Error('device adapter missing');

    const invocation = adapter.invoke({} as never, context(controller.signal));
    await vi.waitFor(() => expect(persistence.enqueued).toHaveLength(1));
    controller.abort();

    await expect(invocation).rejects.toMatchObject({
      name: 'NodeToolInvocationError',
    });
    expect(persistence.expired).toHaveLength(1);
  });

  it('能力解析使用新鲜心跳窗口并保持服务端返回值', async () => {
    const persistence = new MemoryNodeInvocations();
    const list = vi.spyOn(persistence, 'listAvailableCapabilitiesForOperation');
    const capabilities = await resolveAvailableNodeToolCapabilities(
      persistence,
      {
        operationId: 'operation:1',
        actorId: 'actor:1',
        agentId: 'agent:1',
      },
      {
        now: () => new Date('2026-07-22T00:00:30.000Z'),
        activeWindowMs: 20_000,
      },
    );

    expect(capabilities).toEqual(['device.status']);
    expect(list).toHaveBeenCalledWith({
      operationId: 'operation:1',
      actorId: 'actor:1',
      agentId: 'agent:1',
      activeAfter: new Date('2026-07-22T00:00:10.000Z'),
    });
  });
});
