import type { TurnApplicationCommand } from '@educanvas/agent-core';
import type { NodeInvocationPersistencePort } from '@educanvas/node-runtime';
import { describe, expect, it, vi } from 'vitest';
import { GatewayGeneralProfile } from './general-profile';
import type { GatewayTurnRepositoryPort } from './lifecycle';

const turns = {
  async attachGatewayTurn() {
    throw new Error('not_used');
  },
  async settleTurn() {
    throw new Error('not_used');
  },
  async listMessages() {
    return [];
  },
  async isTurnCancellationRequested() {
    return false;
  },
} satisfies GatewayTurnRepositoryPort;

function nodeInvocations(
  capabilities: Awaited<
    ReturnType<
      NodeInvocationPersistencePort['listAvailableCapabilitiesForOperation']
    >
  >,
) {
  return {
    listAvailableCapabilitiesForOperation: vi.fn(async () => capabilities),
    async enqueueForOperation() {
      throw new Error('not_used');
    },
    async readInvocationOutcome() {
      return { status: 'pending' as const };
    },
    async expirePendingInvocation() {},
  } satisfies NodeInvocationPersistencePort;
}

const command: TurnApplicationCommand = {
  protocol: 'educanvas.turn.v2',
  operationId: 'operation:1',
  traceId: 'trace:1',
  actor: { actorId: 'user:1', agentId: 'agent:1' },
  notebook: {
    notebookId: 'notebook:1',
    conversationId: 'conversation:1',
  },
  profile: { profileId: 'general' },
  entrypoint: 'web',
  input: {
    clientMessageId: 'message:1',
    parts: [{ type: 'text', text: '读取我的设备状态' }],
  },
  capabilities: ['root.shell'],
};

const turn = {
  operationId: command.operationId,
  traceId: command.traceId,
  userMessageId: 'message:user:1',
  assistantMessageId: 'message:assistant:1',
  replayed: false,
};

describe('Gateway General Profile Tool Policy', () => {
  it('只采用服务端MCP与当前Actor私人Node能力，不采用command manifest增权', async () => {
    const nodes = nodeInvocations(['device.status']);
    const profile = new GatewayGeneralProfile(
      turns,
      nodes,
      ['knowledge.lookup'],
      'contributor',
    );

    const plan = await profile.prepare({ command, turn });

    expect(nodes.listAvailableCapabilitiesForOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        operationId: 'operation:1',
        actorId: 'user:1',
        agentId: 'agent:1',
      }),
    );
    expect(plan.toolPolicy?.capabilities).toEqual({
      actor: ['device.status', 'knowledge.lookup'],
      notebook: ['device.status', 'knowledge.lookup'],
      profile: ['device.status', 'knowledge.lookup'],
      channel: ['device.status', 'knowledge.lookup'],
      environment: ['device.status', 'knowledge.lookup'],
    });
    expect(
      Object.values(plan.toolPolicy?.capabilities ?? {}).flat(),
    ).not.toContain('root.shell');
  });

  it('Channel入口在未具备交互审批与停止语义前不暴露工具', async () => {
    const profile = new GatewayGeneralProfile(
      turns,
      nodeInvocations(['device.status']),
      ['knowledge.lookup'],
      'owner',
    );

    const plan = await profile.prepare({
      command: { ...command, entrypoint: 'channel' },
      turn,
    });

    expect(plan.toolPolicy?.capabilities.channel).toEqual([]);
    expect(plan.toolPolicy?.approvedCapabilities).toEqual([]);
  });
});
