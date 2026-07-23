import {
  gatewayProtocolVersion,
  type GatewayInboundEnvelope,
  type GatewayOperationEvent,
} from '@educanvas/gateway-core';
import { describe, expect, it } from 'vitest';
import { GatewayCancellationRegistry } from './cancellation';
import { GatewayRuntimeError } from './errors';
import { Sha256GatewayRequestFingerprint } from './fingerprint';
import { GatewayService } from './gateway-service';
import {
  InMemoryGatewayOperationStore,
  InMemoryGatewayRouteResolver,
  SequentialGatewayIdFactory,
} from './in-memory';
import type { GatewayEventPayload, GatewayTurnRunnerPort } from './ports';

const now = new Date('2026-07-19T04:00:00.000Z');

function envelope(text = '解释光合作用'): GatewayInboundEnvelope {
  return {
    protocol: gatewayProtocolVersion,
    envelopeId: 'envelope:1',
    idempotencyKey: 'message:1',
    occurredAt: now.toISOString(),
    connection: {
      connectionId: 'connection:web:1',
      role: 'client',
      transport: 'web',
      adapterId: 'adapter:web',
    },
    principal: {
      subjectId: 'subject:user-1',
      userId: 'user:1',
      agentId: 'agent:1',
      kind: 'user',
      authenticationMethod: 'fixture',
      authenticatedAt: now.toISOString(),
    },
    routeHint: {
      notebookId: 'notebook:1',
      conversationId: 'conversation:1',
    },
    parts: [{ type: 'text', text }],
    capabilities: {
      manifestId: 'manifest:web:1',
      issuedAt: now.toISOString(),
      capabilities: [
        { name: 'input.text', risk: 'l0', version: '1', constraints: {} },
        {
          name: 'output.stream',
          risk: 'l0',
          version: '1',
          constraints: {},
        },
      ],
    },
    replyTarget: {
      kind: 'connection',
      connectionId: 'connection:web:1',
    },
  };
}

function buildService(runner?: GatewayTurnRunnerPort): GatewayService & {
  store: InMemoryGatewayOperationStore;
} {
  const route = {
    actorUserId: 'user:1',
    agentId: 'agent:1',
    notebookId: 'notebook:1',
    conversationId: 'conversation:1',
    agentProfileId: 'general',
    membershipRole: 'owner' as const,
  };
  const resolver = new InMemoryGatewayRouteResolver([
    {
      route,
      membership: {
        notebookId: 'notebook:1',
        userId: 'user:1',
        role: 'owner',
        grantedByUserId: 'user:1',
        grantedAt: '2026-07-19T03:00:00.000Z',
        expiresAt: null,
        revokedAt: null,
      },
    },
  ]);
  const store = new InMemoryGatewayOperationStore(
    new SequentialGatewayIdFactory(),
  );
  const defaultRunner: GatewayTurnRunnerPort = {
    async *run(): AsyncIterable<GatewayEventPayload> {
      yield { type: 'message.delta', delta: '植物把光能转成化学能。' };
      yield { type: 'operation.completed', messageId: 'message:assistant:1' };
    },
  };
  const cancellation = new GatewayCancellationRegistry();
  const service = new GatewayService(
    resolver,
    store,
    runner ?? defaultRunner,
    new Sha256GatewayRequestFingerprint(),
    () => now,
    cancellation,
  );
  return Object.assign(service, { store });
}

async function collect(iterable: AsyncIterable<GatewayOperationEvent>) {
  const values: GatewayOperationEvent[] = [];
  for await (const value of iterable) values.push(value);
  return values;
}

describe('GatewayService', () => {
  it('persists one ordered terminal event stream and replays it idempotently', async () => {
    const service = buildService();
    const first = await collect(service.handle(envelope()));
    const replay = await collect(service.handle(envelope()));

    expect(first.map((event) => event.type)).toEqual([
      'operation.accepted',
      'message.delta',
      'operation.completed',
    ]);
    expect(first.map((event) => event.sequence)).toEqual([0, 1, 2]);
    expect(replay).toEqual(first);
  });

  it('rejects idempotency key reuse with different content', async () => {
    const service = buildService();
    await collect(service.handle(envelope()));
    await expect(
      collect(service.handle(envelope('另一条消息'))),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });

  it('fails closed when a runner exits without a terminal event', async () => {
    const service = buildService({
      async *run() {
        yield { type: 'message.delta', delta: '未完成回答' };
      },
    });
    const events = await collect(service.handle(envelope()));
    expect(events.at(-1)).toMatchObject({
      type: 'operation.failed',
      code: 'RUNTIME_FAILED',
      retryable: true,
    });
  });

  it('keeps an operation resumable when an explicit approval is pending', async () => {
    const service = buildService({
      async *run(input) {
        yield {
          type: 'approval.required',
          approval: {
            approvalId: 'approval:1',
            operationId: input.operationId,
            actorUserId: input.route.actorUserId,
            capability: 'filesystem.read_allowlisted',
            risk: 'l2',
            summary: '读取本地学习资料',
            requestedAt: now.toISOString(),
            expiresAt: new Date(now.getTime() + 60_000).toISOString(),
          },
        };
      },
    });
    const events = await collect(service.handle(envelope()));
    expect(events.map((event) => event.type)).toEqual([
      'operation.accepted',
      'approval.required',
    ]);
    expect(events.some((event) => event.type === 'operation.failed')).toBe(
      false,
    );
  });

  it('rejects a principal without Notebook membership', async () => {
    const service = buildService();
    const other = envelope();
    other.principal = {
      ...other.principal,
      subjectId: 'subject:user-2',
      userId: 'user:2',
      agentId: 'agent:2',
    };
    await expect(collect(service.handle(other))).rejects.toBeInstanceOf(
      GatewayRuntimeError,
    );
  });

  it('does not resume another user operation', async () => {
    const service = buildService();
    const events = await collect(service.handle(envelope()));
    await expect(
      service.resume({
        operationId: events[0]!.operationId,
        afterSequence: -1,
        principalUserId: 'user:2',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('cancels a running operation mid-stream and persists the terminal event', async () => {
    /* runner 发一个 delta 后无限阻塞，模拟慢 Provider；取消必须打断 await */
    let release = () => undefined as void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const service = buildService({
      async *run() {
        yield { type: 'message.delta', delta: '正在思考…' };
        await blocked;
        yield { type: 'operation.completed', messageId: 'never' };
      },
    });
    const iterator = service.handle(envelope())[Symbol.asyncIterator]();
    const accepted = await iterator.next();
    const delta = await iterator.next();
    expect(accepted.value?.type).toBe('operation.accepted');
    expect(delta.value?.type).toBe('message.delta');

    const cancelResult = await service.requestCancel({
      operationId: accepted.value!.operationId,
      principalUserId: 'user:1',
    });
    expect(cancelResult.status).toBe('cancelling');

    const cancelled = await iterator.next();
    expect(cancelled.value).toMatchObject({ type: 'operation.cancelled' });
    expect((await iterator.next()).done).toBe(true);
    release();

    /* 终态已落库：resume 能读回 cancelled，且不再 append */
    const replayed = await service.resume({
      operationId: accepted.value!.operationId,
      afterSequence: -1,
      principalUserId: 'user:1',
    });
    expect(replayed.at(-1)).toMatchObject({ type: 'operation.cancelled' });
  });

  it('reports cross-process continuation cancellation from persistence truth', async () => {
    const service = buildService({
      async *run(input) {
        yield {
          type: 'approval.required',
          approval: {
            approvalId: 'approval:cross-process',
            operationId: input.operationId,
            actorUserId: input.route.actorUserId,
            capability: 'filesystem.read_allowlisted',
            risk: 'l2',
            summary: '跨进程读取',
            requestedAt: now.toISOString(),
            expiresAt: new Date(now.getTime() + 60_000).toISOString(),
          },
        };
      },
    });
    const events = await collect(service.handle(envelope()));
    service.store.requestCancellation = async () => ({
      recorded: true,
      continuation: 'running',
    });
    await expect(
      service.requestCancel({
        operationId: events[0]!.operationId,
        principalUserId: 'user:1',
      }),
    ).resolves.toEqual({ status: 'cancelling' });

    service.store.requestCancellation = async () => ({
      recorded: true,
      continuation: 'cancelled',
    });
    await expect(
      service.requestCancel({
        operationId: events[0]!.operationId,
        principalUserId: 'user:1',
      }),
    ).resolves.toEqual({ status: 'cancelled' });
  });

  it('refuses to cancel another user operation and reports terminal state idempotently', async () => {
    const service = buildService();
    const events = await collect(service.handle(envelope()));
    const operationId = events[0]!.operationId;

    await expect(
      service.requestCancel({ operationId, principalUserId: 'user:2' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    /* 已完成的操作取消是幂等 no-op，回报其终态而非伪造 cancelling */
    const result = await service.requestCancel({
      operationId,
      principalUserId: 'user:1',
    });
    expect(result.status).toBe('completed');
  });

  it('lists a user recent operations without leaking others', async () => {
    const service = buildService();
    await collect(service.handle(envelope()));
    const mine = await service.store.listRecent('user:1');
    const theirs = await service.store.listRecent('user:2');
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({
      conversationId: 'conversation:1',
      status: 'completed',
    });
    expect(theirs).toHaveLength(0);
  });
});
