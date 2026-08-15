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
  it('要求回复只包含对用户说的话，不生成桌宠动作或状态旁白', async () => {
    const profile = new GatewayGeneralProfile(
      turns,
      nodeInvocations([]),
      [],
      'owner',
    );

    const plan = await profile.prepare({ command, turn });
    const systemPrompt = plan.context.profile[0]?.message.content;

    expect(systemPrompt).toContain('只输出直接对用户说的话');
    expect(systemPrompt).toContain(
      '不要输出括号包裹的动作、表情、状态或舞台说明',
    );
  });

  it('在公开和保存前移除被分片的开头动作旁白', async () => {
    const profile = new GatewayGeneralProfile(
      turns,
      nodeInvocations([]),
      [],
      'owner',
    );
    const guard = profile.createOutputGuard?.();

    expect(guard).toBeDefined();
    await expect(guard!.push('(轻轻晃了晃尾巴，')).resolves.toEqual({
      kind: 'hold',
    });
    await expect(
      guard!.push('头顶冒出一朵像素小花) 这是因为植物需要阳光。'),
    ).resolves.toEqual({
      kind: 'emit',
      safeDeltas: ['这是因为植物需要阳光。'],
    });
    await expect(guard!.finish()).resolves.toEqual({
      kind: 'emit',
      safeDeltas: [],
    });
  });

  it('保留正常正文中的括号说明并继续流式输出', async () => {
    const profile = new GatewayGeneralProfile(
      turns,
      nodeInvocations([]),
      [],
      'owner',
    );
    const guard = profile.createOutputGuard?.();

    expect(guard).toBeDefined();
    await expect(guard!.push('答案是（x + 1）²。')).resolves.toEqual({
      kind: 'emit',
      safeDeltas: ['答案是（x + 1）²。'],
    });
  });

  it('移除正常正文之后出现的全角括号动作旁白', async () => {
    const profile = new GatewayGeneralProfile(
      turns,
      nodeInvocations([]),
      [],
      'owner',
    );
    const guard = profile.createOutputGuard?.();

    expect(guard).toBeDefined();
    await expect(guard!.push('好的。')).resolves.toEqual({
      kind: 'emit',
      safeDeltas: ['好的。'],
    });
    await expect(
      guard!.push('（开心地摇了摇尾巴）我们继续学习。'),
    ).resolves.toEqual({
      kind: 'emit',
      safeDeltas: ['我们继续学习。'],
    });
  });

  it('不把教学正文中的普通括号说明误判为桌宠动作', async () => {
    const profile = new GatewayGeneralProfile(
      turns,
      nodeInvocations([]),
      [],
      'owner',
    );
    const guard = profile.createOutputGuard?.();

    expect(guard).toBeDefined();
    await expect(
      guard!.push('这个阶段（思考时间约 3 秒）不需要立即回答。'),
    ).resolves.toEqual({
      kind: 'emit',
      safeDeltas: ['这个阶段（思考时间约 3 秒）不需要立即回答。'],
    });
  });

  it('模型只生成动作旁白时返回正常提示而不是空回复', async () => {
    const profile = new GatewayGeneralProfile(
      turns,
      nodeInvocations([]),
      [],
      'owner',
    );
    const guard = profile.createOutputGuard?.();

    expect(guard).toBeDefined();
    await expect(guard!.push('(轻轻摇了摇尾巴)')).resolves.toEqual({
      kind: 'hold',
    });
    await expect(guard!.finish()).resolves.toEqual({
      kind: 'emit',
      safeDeltas: ['我没有生成有效回答，请再试一次。'],
    });
  });

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
