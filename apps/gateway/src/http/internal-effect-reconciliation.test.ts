import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  ToolEffectReconciliationConflictError,
  ToolEffectReconciliationLifecycleError,
  ToolEffectReconciliationOwnershipError,
} from '@educanvas/db';
import type { GatewayService } from '@educanvas/gateway-runtime';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GatewayEffectReconciliationControl } from '../effect-reconciliation-control';
import { GatewayObservability } from '../observability';
import { createGatewayHttpHandler } from './handler';

const token = 'gateway-test-token-that-is-at-least-32-bytes';
const servers: Server[] = [];
const request = {
  operationId: '00000000-0000-4000-8000-000000000001',
  actorId: 'user:1',
  effectId: '00000000-0000-4000-8000-000000000002',
  effectKey: 'execution:1',
  semanticsHash: 'a'.repeat(64),
  resolution: 'confirmed_not_committed',
  evidenceHash: 'b'.repeat(64),
  code: 'remote_record_absent',
};

async function start(
  effectReconciliation?: Parameters<
    typeof createGatewayHttpHandler
  >[0]['effectReconciliation'],
  observability?: GatewayObservability,
) {
  const server = createServer(
    createGatewayHttpHandler({
      service: {} as GatewayService,
      internalToken: token,
      effectReconciliation,
      observability,
    }),
  );
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

function send(base: string, input: unknown = request, principal?: string) {
  return fetch(`${base}/v1/internal/tool-effects/reconciliations`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(principal
        ? { 'x-educanvas-reconciliation-principal': principal }
        : {}),
    },
    body: JSON.stringify(input),
  });
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    ),
  );
});

describe('Gateway internal effect reconciliation route', () => {
  it('要求Internal token且控制面未注入时诚实返回disabled', async () => {
    const base = await start();
    const unauthenticated = await fetch(
      `${base}/v1/internal/tool-effects/reconciliations`,
      { method: 'POST', body: JSON.stringify(request) },
    );
    expect(unauthenticated.status).toBe(401);

    const disabled = await fetch(
      `${base}/v1/internal/tool-effects/reconciliations`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        body: JSON.stringify(request),
      },
    );
    expect(disabled.status).toBe(503);
    expect(await disabled.json()).toEqual({
      error: { code: 'EFFECT_RECONCILIATION_DISABLED' },
    });
  });

  it('从受信Internal上下文传递operator身份且正文不能伪造', async () => {
    const reconcile = vi
      .fn()
      .mockResolvedValueOnce({
        status: 'recorded',
        recorded: true,
        reconciliation: {
          effectId: request.effectId,
          operationId: request.operationId,
          effectKey: request.effectKey,
          semanticsHash: request.semanticsHash,
          resolution: request.resolution,
          source: 'manual',
          resolverId: 'service:gateway-effect-reconciliation',
          evidenceHash: request.evidenceHash,
          receiptHash: null,
          code: request.code,
          resolvedAt: '2026-07-23T08:00:00.000Z',
        },
      })
      .mockResolvedValueOnce({
        status: 'recorded',
        recorded: false,
        reconciliation: {
          effectId: request.effectId,
          operationId: request.operationId,
          effectKey: request.effectKey,
          semanticsHash: request.semanticsHash,
          resolution: request.resolution,
          source: 'manual',
          resolverId: 'operator:ops-1',
          evidenceHash: request.evidenceHash,
          receiptHash: null,
          code: request.code,
          resolvedAt: '2026-07-23T08:00:00.000Z',
        },
      });
    const base = await start({ reconcile });

    const recorded = await send(base);
    expect(recorded.status).toBe(200);
    expect(await recorded.json()).toMatchObject({
      reconciliation: { status: 'recorded', recorded: true },
    });
    expect(reconcile).toHaveBeenNthCalledWith(1, request, {
      kind: 'service',
      subjectId: 'gateway-effect-reconciliation',
    });

    const replay = await send(base, request, 'operator:ops-1');
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({
      reconciliation: { status: 'recorded', recorded: false },
    });
    expect(reconcile).toHaveBeenNthCalledWith(2, request, {
      kind: 'operator',
      subjectId: 'ops-1',
    });
  });

  it('接受confirmed_committed并诚实映射未改变结果', async () => {
    const committed = {
      ...request,
      resolution: 'confirmed_committed',
      receiptHash: 'c'.repeat(64),
      code: undefined,
    };
    const reconcile = vi
      .fn()
      .mockResolvedValueOnce({
        status: 'recorded',
        recorded: true,
        reconciliation: {
          ...committed,
          source: 'manual',
          resolverId: 'service:gateway-effect-reconciliation',
          resolvedAt: '2026-07-23T08:00:00.000Z',
        },
      })
      .mockResolvedValueOnce({
        status: 'unchanged',
        reason: 'effect_not_reconcilable',
      });
    const base = await start({ reconcile });

    expect((await send(base, committed)).status).toBe(200);
    const unchanged = await send(base);
    expect(unchanged.status).toBe(409);
    expect(await unchanged.json()).toEqual({
      reconciliation: {
        status: 'unchanged',
        reason: 'effect_not_reconcilable',
      },
    });
  });

  it('拒绝非法header、哈希和决议形状', async () => {
    const base = await start(
      new GatewayEffectReconciliationControl({
        reconcileManually: vi.fn(),
      }),
    );
    const invalidPrincipal = await send(base, request, 'student:forged');
    expect(invalidPrincipal.status).toBe(400);

    const invalidHash = await send(base, {
      ...request,
      evidenceHash: 'not-a-hash',
    });
    expect(invalidHash.status).toBe(400);

    const invalidShape = await send(base, {
      ...request,
      resolution: 'confirmed_not_committed',
      receiptHash: 'c'.repeat(64),
    });
    expect(invalidShape.status).toBe(400);

    const forgedBody = await send(base, {
      ...request,
      principal: { kind: 'operator', subjectId: 'forged' },
    });
    expect(forgedBody.status).toBe(400);
  });

  it.each([
    [new ToolEffectReconciliationOwnershipError(), 404, 'NOT_FOUND'],
    [new ToolEffectReconciliationConflictError(), 409, 'INVALID_STATE'],
    [
      new ToolEffectReconciliationLifecycleError('invalid lifecycle'),
      409,
      'INVALID_STATE',
    ],
  ])('将预期业务错误映射为非500响应', async (error, status, code) => {
    const base = await start({
      reconcile: vi.fn().mockRejectedValue(error),
    });
    const response = await send(base);
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: { code } });
  });

  it('观测日志不记录对账正文、哈希或审计主体', async () => {
    const records: unknown[] = [];
    const observability = new GatewayObservability((record) =>
      records.push(record),
    );
    const base = await start(
      {
        reconcile: vi.fn().mockResolvedValue({
          status: 'unchanged',
          reason: 'effect_not_reconcilable',
        }),
      },
      observability,
    );
    const response = await send(base, request, 'operator:private-operator');
    expect(response.status).toBe(409);

    const serialized = JSON.stringify(records);
    for (const forbidden of [
      request.actorId,
      request.effectId,
      request.effectKey,
      request.evidenceHash,
      'private-operator',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(records).toEqual([
      expect.objectContaining({
        event: 'gateway.http',
        route: 'internal.tool-effect.reconciliation',
        status: 409,
      }),
    ]);
  });
});
