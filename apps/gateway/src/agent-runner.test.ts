import type {
  TurnApplicationCommand,
  TurnApplicationEvent,
} from '@educanvas/agent-core';
import {
  gatewayProtocolVersion,
  type GatewayInboundEnvelope,
  type GatewayResolvedRoute,
} from '@educanvas/gateway-core';
import { describe, expect, it, vi, type Mock } from 'vitest';
import { GatewayAgentTurnRunner } from './agent-runner';
import type { GatewayDependencies } from './turn-composition';

vi.mock('./turn-composition', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./turn-composition')>();
  return {
    ...actual,
    createGatewayTurnApplication: vi.fn(),
  };
});

const envelope: GatewayInboundEnvelope = {
  protocol: gatewayProtocolVersion,
  envelopeId: 'envelope:1',
  idempotencyKey: 'message:1',
  occurredAt: '2026-07-21T10:00:00.000Z',
  connection: {
    connectionId: 'connection:web:1',
    role: 'client',
    transport: 'web',
    adapterId: 'adapter:web',
  },
  principal: {
    subjectId: 'subject:user:1',
    userId: 'user:1',
    agentId: 'agent:1',
    kind: 'user',
    authenticationMethod: 'session_cookie',
    authenticatedAt: '2026-07-21T10:00:00.000Z',
  },
  routeHint: {
    notebookId: 'notebook:1',
    conversationId: 'conversation:1',
  },
  parts: [{ type: 'text', text: '解释勾股定理' }],
  capabilities: {
    manifestId: 'manifest:1',
    issuedAt: '2026-07-21T10:00:00.000Z',
    capabilities: [
      { name: 'input.text', risk: 'l0', version: '1', constraints: {} },
      { name: 'output.markdown', risk: 'l0', version: '1', constraints: {} },
    ],
  },
  replyTarget: { kind: 'connection', connectionId: 'connection:web:1' },
};

const route: GatewayResolvedRoute = {
  actorUserId: 'user:1',
  agentId: 'agent:1',
  notebookId: 'notebook:1',
  conversationId: 'conversation:1',
  agentProfileId: 'general',
  membershipRole: 'owner',
};

const signal = {
  aborted: false,
  addEventListener() {},
  removeEventListener() {},
};

async function collect(
  runner: GatewayAgentTurnRunner,
  inputEnvelope = envelope,
) {
  const events = [];
  for await (const event of runner.run({
    operationId: 'operation:1',
    traceId: 'trace:gateway:1',
    envelope: inputEnvelope,
    route,
    signal,
  })) {
    events.push(event);
  }
  return events;
}

describe('Gateway Turn Application adapter', () => {
  it('只投影可信route为统一command并映射回Gateway事件', async () => {
    const captured: { command?: TurnApplicationCommand } = {};
    let capturedSignal: typeof signal | null = null;
    let capturedRoute: GatewayResolvedRoute | null = null;
    const runner = new GatewayAgentTurnRunner((input) => {
      capturedSignal = input.signal as typeof signal;
      capturedRoute = input.route;
      return {
        async *run(command): AsyncIterable<TurnApplicationEvent> {
          captured.command = command;
          yield {
            protocol: 'educanvas.turn.v2',
            operationId: command.operationId,
            type: 'turn.started',
            userMessageId: 'message:user:1',
            assistantMessageId: 'message:assistant:1',
            replayed: false,
          };
          yield {
            protocol: 'educanvas.turn.v2',
            operationId: command.operationId,
            type: 'message.delta',
            messageId: 'message:assistant:1',
            delta: '回答',
          };
          yield {
            protocol: 'educanvas.turn.v2',
            operationId: command.operationId,
            type: 'turn.completed',
            messageId: 'message:assistant:1',
          };
        },
      };
    });

    const events = await collect(runner);
    expect(capturedSignal).toBe(signal);
    expect(capturedRoute).toBe(route);
    expect(captured.command).toMatchObject({
      operationId: 'operation:1',
      traceId: 'trace:gateway:1',
      actor: { actorId: 'user:1', agentId: 'agent:1' },
      notebook: {
        notebookId: 'notebook:1',
        conversationId: 'conversation:1',
      },
      profile: { profileId: 'general' },
      entrypoint: 'web',
      capabilities: ['input.text', 'output.markdown'],
    });
    expect(captured.command?.input).toEqual({
      clientMessageId: 'message:1',
      parts: [{ type: 'text', text: '解释勾股定理' }],
    });
    expect(events).toEqual([
      {
        type: 'message.started',
        userMessageId: 'message:user:1',
        assistantMessageId: 'message:assistant:1',
        replayed: false,
      },
      { type: 'message.delta', delta: '回答' },
      { type: 'operation.completed', messageId: 'message:assistant:1' },
    ]);
  });

  it('对尚未接通的Asset明确失败且不创建应用服务', async () => {
    let created = false;
    const runner = new GatewayAgentTurnRunner(() => {
      created = true;
      throw new Error('should_not_create');
    });
    const events = await collect(runner, {
      ...envelope,
      parts: [
        {
          type: 'asset_ref',
          reference: {
            assetId: 'asset:1',
            versionId: 'asset-version:1',
            kind: 'document',
          },
          usage: 'attachment',
        },
      ],
    });

    expect(created).toBe(false);
    expect(events).toEqual([
      {
        type: 'operation.failed',
        code: 'CAPABILITY_UNAVAILABLE',
        retryable: false,
      },
    ]);
  });

  it('对尚未接通的会话Profile明确失败且不静默降级', async () => {
    let created = false;
    const runner = new GatewayAgentTurnRunner(() => {
      created = true;
      throw new Error('should_not_create');
    });
    const events = [];
    for await (const event of runner.run({
      operationId: 'operation:1',
      traceId: 'trace:gateway:1',
      envelope,
      route: { ...route, agentProfileId: 'k12.teacher' },
      signal,
    })) {
      events.push(event);
    }

    expect(created).toBe(false);
    expect(events).toEqual([
      {
        type: 'operation.failed',
        code: 'CAPABILITY_UNAVAILABLE',
        retryable: false,
      },
    ]);
  });

  it('注入assetMaterializer后透传text与asset_ref到命令输入（DP10）', async () => {
    const { createGatewayTurnApplication } = await import('./turn-composition');
    const captured: { command?: TurnApplicationCommand } = {};
    (createGatewayTurnApplication as Mock).mockImplementation(
      (_deps: GatewayDependencies, _input: unknown) => ({
        async *run(command: TurnApplicationCommand) {
          captured.command = command;
          yield {
            protocol: 'educanvas.turn.v2',
            operationId: command.operationId,
            type: 'turn.started',
            userMessageId: 'u:1',
            assistantMessageId: 'a:1',
            replayed: false,
          };
          yield {
            protocol: 'educanvas.turn.v2',
            operationId: command.operationId,
            type: 'turn.completed',
            messageId: 'a:1',
          };
        },
      }),
    );
    const runner = new GatewayAgentTurnRunner({
      assetMaterializer: { materializeOwnedReferences: async () => ({}) },
    } as unknown as GatewayDependencies);
    const textPart = { type: 'text' as const, text: '看看这张图' };
    const assetRefPart = {
      type: 'asset_ref' as const,
      reference: {
        assetId: 'asset:1',
        versionId: 'version:1',
        kind: 'image' as const,
      },
      usage: 'attachment' as const,
    };
    const events = await collect(runner, {
      ...envelope,
      parts: [textPart, assetRefPart],
    });
    expect(captured.command?.input.parts).toEqual([textPart, assetRefPart]);
    expect(events.map((event) => event.type)).toEqual([
      'message.started',
      'operation.completed',
    ]);
  });

  it('注入materializer后仍拒绝非text/非asset_ref的part（DP10）', async () => {
    const runner = new GatewayAgentTurnRunner({
      assetMaterializer: { materializeOwnedReferences: async () => ({}) },
    } as unknown as GatewayDependencies);
    const events = await collect(runner, {
      ...envelope,
      parts: [
        { type: 'text', text: 'hello' },
        {
          type: 'artifact_ref',
          artifactId: 'artifact:1',
          versionId: 'version:1',
          kind: 'markdown_document',
        },
      ],
    });
    expect(events).toEqual([
      {
        type: 'operation.failed',
        code: 'CAPABILITY_UNAVAILABLE',
        retryable: false,
      },
    ]);
  });
});
