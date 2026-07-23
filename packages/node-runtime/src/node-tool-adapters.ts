import { createHash } from 'node:crypto';
import type { ToolKernelAdapter } from '@educanvas/agent-runtime';
import type {
  GatewayNodeInvocationRequest,
  GatewayNodeInvocationResult,
} from '@educanvas/gateway-core';
import { z } from 'zod';

export const NODE_TOOL_CAPABILITIES = [
  'device.status',
  'filesystem.read_allowlisted',
] as const;
export type NodeToolCapability = (typeof NODE_TOOL_CAPABILITIES)[number];

export interface NodeToolScope {
  operationId: string;
  actorId: string;
  agentId: string;
}

export type NodeInvocationOutcome =
  | { status: 'pending' }
  | { status: 'expired' }
  | {
      status: 'settled';
      result: GatewayNodeInvocationResult;
    };

/**
 * Node Adapter只依赖这一持久端口；实现必须从Operation事实重新校验Actor/Agent，
 * 不能接受模型或客户端提供nodeId，也不能把共享Notebook成员映射到所有者私人Node。
 */
export interface NodeInvocationPersistencePort {
  listAvailableCapabilitiesForOperation(
    input: NodeToolScope & { activeAfter: Date },
  ): Promise<readonly NodeToolCapability[]>;
  enqueueForOperation(
    input: NodeToolScope & {
      requestId: string;
      capability: NodeToolCapability;
      parameters: GatewayNodeInvocationRequest['parameters'];
      nonce: string;
      issuedAt: Date;
      expiresAt: Date;
      activeAfter: Date;
    },
  ): Promise<GatewayNodeInvocationRequest>;
  readInvocationOutcome(
    input: NodeToolScope & { requestId: string; now?: Date },
  ): Promise<NodeInvocationOutcome>;
  expirePendingInvocation(
    input: NodeToolScope & { requestId: string; now?: Date },
  ): Promise<void>;
}

export interface NodeToolRuntimeOptions {
  now?: () => Date;
  activeWindowMs?: number;
  requestTtlMs?: number;
  pollIntervalMs?: number;
  adapterTimeoutMs?: number;
}

/** 对模型只暴露稳定失败，底层Node标识、路径和执行错误不得进入模型输出。 */
export class NodeToolInvocationError extends Error {
  override readonly name = 'NodeToolInvocationError';
}

const deviceStatusInputSchema = z.object({}).strict();
const deviceStatusOutputSchema = z
  .object({
    platform: z.string().min(1).max(64),
    architecture: z.string().min(1).max(64),
    hostname: z.string().min(1).max(255),
    uptimeSeconds: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  })
  .strict();

const nodeFileInputSchema = z
  .object({
    operation: z.enum(['list', 'read']),
    root: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[A-Za-z0-9._-]+$/),
    relativePath: z.string().max(1_024).default('.'),
    maxBytes: z.number().int().min(1).max(1_000_000).default(256_000),
  })
  .strict();

const nodeFileOutputSchema = z.union([
  z
    .object({
      entries: z
        .array(
          z
            .object({
              name: z.string().min(1).max(1_024),
              kind: z.enum(['directory', 'file']),
            })
            .strict(),
        )
        .max(200),
      truncated: z.boolean(),
    })
    .strict(),
  z
    .object({
      content: z.string().max(1_000_000),
      sizeBytes: z.number().int().nonnegative().max(1_000_000),
    })
    .strict(),
]);

const boundedInteger = (
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  name: string,
): number => {
  const resolved = value ?? fallback;
  if (
    !Number.isSafeInteger(resolved) ||
    resolved < minimum ||
    resolved > maximum
  ) {
    throw new Error(`${name}必须是${minimum}到${maximum}之间的整数`);
  }
  return resolved;
};

function waitForPoll(signal: AbortSignal, delayMs: number): Promise<void> {
  if (signal.aborted) return Promise.reject(new NodeToolInvocationError());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, delayMs);
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      reject(new NodeToolInvocationError());
    };
    signal.addEventListener('abort', abort, { once: true });
  });
}

function stableInvocationId(executionId: string, suffix: string): string {
  return `node-tool:${suffix}:${createHash('sha256').update(executionId).digest('hex')}`;
}

function createInvoker(
  persistence: NodeInvocationPersistencePort,
  options: Required<NodeToolRuntimeOptions>,
) {
  return async (
    capability: NodeToolCapability,
    parameters: GatewayNodeInvocationRequest['parameters'],
    context: {
      operationId: string;
      actorId: string;
      agentId: string;
      executionId: string;
      signal: AbortSignal;
    },
  ): Promise<unknown> => {
    const scope = {
      operationId: context.operationId,
      actorId: context.actorId,
      agentId: context.agentId,
    };
    const issuedAt = options.now();
    const requestId = stableInvocationId(context.executionId, 'request');
    await persistence.enqueueForOperation({
      ...scope,
      requestId,
      capability,
      parameters,
      nonce: stableInvocationId(context.executionId, 'nonce'),
      issuedAt,
      expiresAt: new Date(issuedAt.getTime() + options.requestTtlMs),
      activeAfter: new Date(issuedAt.getTime() - options.activeWindowMs),
    });
    try {
      while (true) {
        if (context.signal.aborted) throw new NodeToolInvocationError();
        const outcome = await persistence.readInvocationOutcome({
          ...scope,
          requestId,
          now: options.now(),
        });
        if (outcome.status === 'expired') throw new NodeToolInvocationError();
        if (outcome.status === 'settled') {
          if (outcome.result.status !== 'completed') {
            throw new NodeToolInvocationError();
          }
          return outcome.result.output;
        }
        await waitForPoll(context.signal, options.pollIntervalMs);
      }
    } catch (error) {
      await persistence
        .expirePendingInvocation({ ...scope, requestId, now: options.now() })
        .catch(() => undefined);
      throw error instanceof NodeToolInvocationError
        ? error
        : new NodeToolInvocationError();
    }
  };
}

function resolveOptions(
  input: NodeToolRuntimeOptions = {},
): Required<NodeToolRuntimeOptions> {
  const requestTtlMs = boundedInteger(
    input.requestTtlMs,
    30_000,
    1_000,
    5 * 60_000,
    'requestTtlMs',
  );
  const adapterTimeoutMs = boundedInteger(
    input.adapterTimeoutMs,
    35_000,
    requestTtlMs,
    10 * 60_000,
    'adapterTimeoutMs',
  );
  return {
    now: input.now ?? (() => new Date()),
    activeWindowMs: boundedInteger(
      input.activeWindowMs,
      20_000,
      5_000,
      5 * 60_000,
      'activeWindowMs',
    ),
    requestTtlMs,
    pollIntervalMs: boundedInteger(
      input.pollIntervalMs,
      250,
      10,
      5_000,
      'pollIntervalMs',
    ),
    adapterTimeoutMs,
  };
}

/** 从服务端Operation和新鲜心跳重新计算私人Node能力，绝不采用客户端manifest。 */
export async function resolveAvailableNodeToolCapabilities(
  persistence: NodeInvocationPersistencePort,
  scope: NodeToolScope,
  runtimeOptions: NodeToolRuntimeOptions = {},
): Promise<readonly NodeToolCapability[]> {
  const options = resolveOptions(runtimeOptions);
  const now = options.now();
  return persistence.listAvailableCapabilitiesForOperation({
    ...scope,
    activeAfter: new Date(now.getTime() - options.activeWindowMs),
  });
}

/**
 * 创建Node的两项只读Tool Adapter。L0/L1风险与Capability Node协议一致；
 * 本阶段明确不提供Shell、写文件或任何L2/L3设备能力。
 */
export function createNodeToolAdapters(
  persistence: NodeInvocationPersistencePort,
  runtimeOptions: NodeToolRuntimeOptions = {},
): readonly ToolKernelAdapter[] {
  const options = resolveOptions(runtimeOptions);
  const invoke = createInvoker(persistence, options);
  return [
    {
      name: 'getDeviceStatus',
      description: '读取当前用户已配对且在线设备的系统状态。',
      source: 'node',
      capability: 'device.status',
      risk: 'l0',
      exposure: 'model',
      effect: 'read',
      timeoutMs: options.adapterTimeoutMs,
      inputSchema: deviceStatusInputSchema,
      outputSchema: deviceStatusOutputSchema,
      invoke: (input, context) =>
        invoke(
          'device.status',
          input as GatewayNodeInvocationRequest['parameters'],
          context,
        ),
    },
    {
      name: 'readNodeFile',
      description:
        '列出或读取当前用户设备中管理员预先配置的白名单目录；不能访问其他路径、写文件或执行命令。',
      source: 'node',
      capability: 'filesystem.read_allowlisted',
      risk: 'l1',
      exposure: 'model',
      effect: 'read',
      timeoutMs: options.adapterTimeoutMs,
      inputSchema: nodeFileInputSchema,
      outputSchema: nodeFileOutputSchema,
      invoke: (input, context) =>
        invoke(
          'filesystem.read_allowlisted',
          input as GatewayNodeInvocationRequest['parameters'],
          context,
        ),
    },
  ];
}
