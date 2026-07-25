import type { TurnApplicationCommand } from '@educanvas/agent-core';
import type {
  BuiltAssetContext,
  TurnApplicationLifecycleSnapshot,
} from '@educanvas/agent-runtime';
import type { NodeInvocationPersistencePort } from '@educanvas/node-runtime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { webGeneralTurns } from './general-turn-persistence';
import type { WebOperationArtifacts } from './general-artifact-tool';
import { WebGeneralProfile } from './general-turn-profile';
import type { WebOperationSources } from './general-turn-tools';

vi.mock('server-only', () => ({}));

const assetContext: BuiltAssetContext = {
  text: '',
  textSegments: [],
  nativeReferences: [],
};
const command: TurnApplicationCommand = {
  protocol: 'educanvas.turn.v2',
  operationId: 'operation-1',
  traceId: 'trace-1',
  actor: { actorId: 'actor-1', agentId: 'agent-1' },
  notebook: {
    notebookId: 'notebook-1',
    conversationId: 'conversation-1',
  },
  profile: { profileId: 'general' },
  entrypoint: 'web',
  input: {
    clientMessageId: 'client-message-1',
    parts: [{ type: 'text', text: '你好' }],
  },
  capabilities: ['input.text', 'output.markdown', 'root.shell'],
};
const turn: TurnApplicationLifecycleSnapshot = {
  operationId: command.operationId,
  traceId: command.traceId,
  userMessageId: 'message-user-1',
  assistantMessageId: 'message-assistant-1',
  replayed: false,
};

function createNodeInvocations(
  capabilities: readonly ('device.status' | 'filesystem.read_allowlisted')[] = [
    'device.status',
  ],
): NodeInvocationPersistencePort {
  return {
    listAvailableCapabilitiesForOperation: vi
      .fn()
      .mockResolvedValue(capabilities),
    enqueueForOperation: vi.fn(),
    readInvocationOutcome: vi.fn(),
    expirePendingInvocation: vi.fn(),
  };
}

function createProfile(input?: {
  nodeInvocations?: NodeInvocationPersistencePort;
  membershipRole?: 'owner' | 'editor' | 'contributor' | 'viewer';
  staticToolCapabilities?: readonly string[];
  operationArtifacts?: WebOperationArtifacts;
  preferCanvas?: boolean;
}) {
  return new WebGeneralProfile(
    assetContext,
    { sourceCount: 0 } as unknown as WebOperationSources,
    input?.operationArtifacts ??
      ({ events: () => [] } as unknown as WebOperationArtifacts),
    input?.preferCanvas ?? false,
    input?.staticToolCapabilities ?? ['web.fetch', 'web.search'],
    input?.nodeInvocations ?? createNodeInvocations(),
    input?.membershipRole ?? 'owner',
  );
}

beforeEach(() => {
  vi.spyOn(webGeneralTurns, 'listMessages').mockResolvedValue([]);
  process.env.EDUCANVAS_DEPLOYMENT_ENV = 'test';
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.EDUCANVAS_DEPLOYMENT_ENV;
});

describe('WebGeneralProfile trusted Tool Policy', () => {
  it('仅按当前 Operation、Actor 与 Agent 解析私人 Node capability', async () => {
    const nodeInvocations = createNodeInvocations([
      'device.status',
      'filesystem.read_allowlisted',
    ]);
    const profile = createProfile({ nodeInvocations });

    const plan = await profile.prepare({ command, turn });

    expect(
      nodeInvocations.listAvailableCapabilitiesForOperation,
    ).toHaveBeenCalledWith({
      operationId: command.operationId,
      actorId: command.actor.actorId,
      agentId: command.actor.agentId,
      activeAfter: expect.any(Date),
    });
    expect(plan.toolPolicy?.capabilities.actor).toEqual([
      'device.status',
      'filesystem.read_allowlisted',
      'web.fetch',
      'web.search',
    ]);
  });

  it('command transport/render capabilities 不影响 Tool grant', async () => {
    const withManifest = await createProfile().prepare({ command, turn });
    const withoutManifest = await createProfile().prepare({
      command: { ...command, capabilities: [] },
      turn,
    });

    expect(withManifest.toolPolicy).toEqual(withoutManifest.toolPolicy);
    expect(withManifest.toolPolicy?.capabilities.channel).not.toContain(
      'root.shell',
    );
    expect(withManifest.toolPolicy?.capabilities.channel).not.toContain(
      'input.text',
    );
  });

  it('Node 离线与未注册 Adapter 不会凭空出现在授权中', async () => {
    const nodeInvocations = createNodeInvocations();
    vi.mocked(
      nodeInvocations.listAvailableCapabilitiesForOperation,
    ).mockRejectedValue(new Error('node offline'));
    const plan = await createProfile({
      nodeInvocations,
      staticToolCapabilities: ['web.fetch'],
    }).prepare({ command, turn });

    for (const grant of Object.values(plan.toolPolicy?.capabilities ?? {})) {
      expect(grant).toEqual(['web.fetch']);
      expect(grant).not.toContain('device.status');
      expect(grant).not.toContain('web.search');
      expect(grant).not.toContain('external.mcp.invoke');
    }
  });

  it('未知 Profile 与环境均 fail closed', async () => {
    const unknownProfile = await createProfile().prepare({
      command: {
        ...command,
        profile: { profileId: 'agent.general' },
      },
      turn,
    });
    process.env.EDUCANVAS_DEPLOYMENT_ENV = 'unknown';
    const unknownEnvironment = await createProfile().prepare({ command, turn });

    for (const plan of [unknownProfile, unknownEnvironment]) {
      expect(
        Object.values(plan.toolPolicy?.capabilities ?? {}).every(
          (value) => value.length === 0,
        ),
      ).toBe(true);
      expect(plan.toolPolicy?.approvedCapabilities).toEqual([]);
    }
  });

  it('viewer 即使拥有在线 Node 也不能获得 Notebook 工具授权', async () => {
    const plan = await createProfile({ membershipRole: 'viewer' }).prepare({
      command,
      turn,
    });

    expect(plan.toolPolicy?.capabilities.actor).toContain('device.status');
    expect(plan.toolPolicy?.capabilities.notebook).toEqual([]);
  });

  it('把本轮真实创建的 Canvas 产物投影到终态事件', async () => {
    const event = {
      protocol: 'educanvas.turn.v2' as const,
      operationId: command.operationId,
      type: 'artifact.proposed' as const,
      artifactId: 'artifact-1',
      artifactKind: 'mind_map',
      trustTier: 'tier1' as const,
      title: '分数思维导图',
    };
    const profile = createProfile({
      operationArtifacts: {
        events: () => [event],
      } as unknown as WebOperationArtifacts,
    });

    await expect(
      profile.finalize({ command, turn, content: '已经开始生成。' }),
    ).resolves.toEqual({
      citationMarkers: [],
      events: [event],
    });
  });

  it('Canvas 偏好只强化本轮输出指令而不改变可信 Tool grant', async () => {
    const normal = await createProfile().prepare({ command, turn });
    const canvas = await createProfile({ preferCanvas: true }).prepare({
      command,
      turn,
    });
    const canvasSystemPrompt = canvas.context.profile[0]?.message.content ?? '';

    expect(canvasSystemPrompt).toContain('必须调用 createCanvasArtifact');
    expect(canvasSystemPrompt).toContain('不要用 ASCII 图');
    expect(canvas.toolPolicy).toEqual(normal.toolPolicy);
  });
});
