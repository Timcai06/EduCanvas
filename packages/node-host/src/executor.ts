import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  gatewayNodeInvocationRequestSchema,
  type GatewayCapabilityManifest,
  type GatewayNodeInvocationRequest,
  type GatewayNodeInvocationResult,
} from '@educanvas/gateway-core';
import { z } from 'zod';

const fileParametersSchema = z
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

export interface NodeHostOptions {
  nodeId: string;
  capabilities: GatewayCapabilityManifest;
  roots?: Readonly<Record<string, string>>;
  now?: () => Date;
  revoked?: () => boolean;
}

type FailureCode = Extract<
  GatewayNodeInvocationResult,
  { status: 'failed' | 'rejected' }
>['code'];

function failure(
  request: Pick<GatewayNodeInvocationRequest, 'requestId' | 'nodeId'>,
  code: FailureCode,
  now: Date,
  retryable = false,
): GatewayNodeInvocationResult {
  return {
    requestId: request.requestId,
    nodeId: request.nodeId,
    status: 'rejected',
    completedAt: now.toISOString(),
    code,
    retryable,
  };
}

function isWithin(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return (
    relative === '' ||
    (!relative.startsWith('..') && !path.isAbsolute(relative))
  );
}

export class SafeNodeHostExecutor {
  private readonly now: () => Date;
  private readonly revoked: () => boolean;
  private readonly roots = new Map<string, string>();
  private readonly seen = new Set<string>();

  private constructor(private readonly options: NodeHostOptions) {
    this.now = options.now ?? (() => new Date());
    this.revoked = options.revoked ?? (() => false);
  }

  static async create(options: NodeHostOptions): Promise<SafeNodeHostExecutor> {
    const executor = new SafeNodeHostExecutor(options);
    for (const [name, root] of Object.entries(options.roots ?? {})) {
      if (!/^[A-Za-z0-9._-]+$/.test(name))
        throw new Error('Invalid root alias');
      executor.roots.set(name, await realpath(root));
    }
    return executor;
  }

  async execute(raw: unknown): Promise<GatewayNodeInvocationResult> {
    const parsed = gatewayNodeInvocationRequestSchema.safeParse(raw);
    const now = this.now();
    if (!parsed.success) {
      const candidate = raw as { requestId?: unknown; nodeId?: unknown };
      return failure(
        {
          requestId:
            typeof candidate?.requestId === 'string'
              ? candidate.requestId
              : 'invalid-request',
          nodeId:
            typeof candidate?.nodeId === 'string'
              ? candidate.nodeId
              : this.options.nodeId,
        },
        'INVALID_PARAMETERS',
        now,
      );
    }
    const request = parsed.data;
    if (request.nodeId !== this.options.nodeId) {
      return failure(request, 'CAPABILITY_NOT_ALLOWED', now);
    }
    if (this.revoked()) return failure(request, 'NODE_REVOKED', now);
    if (new Date(request.expiresAt).getTime() <= now.getTime()) {
      return failure(request, 'REQUEST_EXPIRED', now);
    }
    if (new Date(request.issuedAt).getTime() > now.getTime() + 60_000) {
      return failure(request, 'INVALID_PARAMETERS', now);
    }
    const replayKey = `${request.requestId}:${request.nonce}`;
    if (this.seen.has(replayKey)) {
      return failure(request, 'REQUEST_REPLAYED', now);
    }
    this.seen.add(replayKey);
    const allowed = this.options.capabilities.capabilities.some(
      (capability) => capability.name === request.capability,
    );
    if (!allowed) return failure(request, 'CAPABILITY_NOT_ALLOWED', now);

    if (request.capability === 'device.status') {
      if (
        typeof request.parameters !== 'object' ||
        request.parameters === null ||
        Array.isArray(request.parameters) ||
        Object.keys(request.parameters).length !== 0
      ) {
        return failure(request, 'INVALID_PARAMETERS', now);
      }
      return {
        requestId: request.requestId,
        nodeId: request.nodeId,
        status: 'completed',
        completedAt: now.toISOString(),
        output: {
          platform: os.platform(),
          architecture: os.arch(),
          hostname: os.hostname(),
          uptimeSeconds: Math.floor(os.uptime()),
        },
      };
    }

    const parameters = fileParametersSchema.safeParse(request.parameters);
    if (!parameters.success) return failure(request, 'INVALID_PARAMETERS', now);
    const root = this.roots.get(parameters.data.root);
    if (!root) return failure(request, 'PATH_NOT_ALLOWED', now);
    if (
      path.isAbsolute(parameters.data.relativePath) ||
      parameters.data.relativePath.split(/[\\/]+/).includes('..')
    ) {
      return failure(request, 'PATH_NOT_ALLOWED', now);
    }
    let target: string;
    try {
      target = await realpath(path.join(root, parameters.data.relativePath));
    } catch {
      return failure(request, 'PATH_NOT_ALLOWED', now);
    }
    if (!isWithin(root, target))
      return failure(request, 'PATH_NOT_ALLOWED', now);
    try {
      const metadata = await stat(target);
      if (parameters.data.operation === 'list') {
        if (!metadata.isDirectory()) {
          return failure(request, 'INVALID_PARAMETERS', now);
        }
        const entries = await readdir(target, { withFileTypes: true });
        return {
          requestId: request.requestId,
          nodeId: request.nodeId,
          status: 'completed',
          completedAt: now.toISOString(),
          output: {
            entries: entries.slice(0, 200).map((entry) => ({
              name: entry.name,
              kind: entry.isDirectory() ? 'directory' : 'file',
            })),
            truncated: entries.length > 200,
          },
        };
      }
      if (!metadata.isFile() || metadata.size > parameters.data.maxBytes) {
        return failure(request, 'PATH_NOT_ALLOWED', now);
      }
      return {
        requestId: request.requestId,
        nodeId: request.nodeId,
        status: 'completed',
        completedAt: now.toISOString(),
        output: {
          content: await readFile(target, 'utf8'),
          sizeBytes: metadata.size,
        },
      };
    } catch {
      return failure(request, 'EXECUTION_FAILED', now, true);
    }
  }
}
