import {
  modelMessageText,
  type TurnApplicationCommand,
} from '@educanvas/agent-core';
import type { TurnApplicationLifecycleSnapshot } from '@educanvas/agent-runtime';
import type { MaterializedAssetPlan } from '../assets/asset-materialization';
import type { NodeInvocationPersistencePort } from '@educanvas/node-runtime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { webGeneralTurns } from './general-turn-persistence';
import type { WebOperationArtifacts } from './general-artifact-tool';
import type { WebOperationImageArtifacts } from './general-image-tool';
import { WebGeneralProfile } from './general-turn-profile';
import type { WebOperationSources } from './general-turn-tools';

vi.mock('server-only', () => ({}));

const assetContext: MaterializedAssetPlan = {
  text: '',
  textSegments: [],
  nativeReferences: [],
  nativeImages: [],
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
  operationImages?: WebOperationImageArtifacts;
  outputPreference?:
    'auto' | 'markdown_document' | 'interactive_artifact' | 'web_app';
  assetContext?: MaterializedAssetPlan;
  operationSources?: WebOperationSources;
  successfulSearchCount?: number;
}) {
  return new WebGeneralProfile(
    input?.assetContext ?? assetContext,
    input?.operationSources ??
      ({ sourceCount: 0 } as unknown as WebOperationSources),
    input?.operationArtifacts ??
      ({ events: () => [] } as unknown as WebOperationArtifacts),
    input?.operationImages ??
      ({ events: () => [] } as unknown as WebOperationImageArtifacts),
    input?.outputPreference ?? 'auto',
    input?.staticToolCapabilities ?? ['web.fetch', 'web.search'],
    input?.nodeInvocations ?? createNodeInvocations(),
    input?.membershipRole ?? 'owner',
    { successfulSearchCount: input?.successfulSearchCount ?? 0 },
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
  it('Deep Research 复用同一 Profile Port，但提升到 4 个工具轮次并冻结研究提示', async () => {
    const plan = await createProfile().prepare({
      command: { ...command, mode: 'deep_research' },
      turn,
    });
    const prompt = plan.context.profile[0]?.message.content ?? '';

    expect(plan.model.maxToolRounds).toBe(4);
    expect(prompt).toContain('至少完成三轮');
    expect(prompt).toContain('分析证据缺口');
    expect(prompt).toContain('关键结论与证据');
    expect(prompt).toContain('不得引用搜索摘要');
  });

  it('Deep Research 仅在三轮搜索、五个来源和五个有效引用都满足时放行报告', async () => {
    const profile = createProfile({
      operationSources: { sourceCount: 5 } as WebOperationSources,
      successfulSearchCount: 3,
    });
    const guard = profile.createOutputGuard!({
      command: { ...command, mode: 'deep_research' },
      turn,
    });
    const report =
      '# 摘要\n结论一[1]，结论二[2]，结论三[3]，结论四[4]，结论五[5]。';

    await expect(guard.push(report)).resolves.toEqual({ kind: 'hold' });
    await expect(guard.finish()).resolves.toEqual({
      kind: 'emit',
      safeDeltas: [report],
    });
  });

  it.each([
    { searches: 2, sources: 5, report: '[1][2][3][4][5]' },
    { searches: 3, sources: 4, report: '[1][2][3][4]' },
    { searches: 3, sources: 5, report: '[1][2][3][4]' },
  ])('Deep Research 证据门槛不足时返回稳定安全失败 %#', async (scenario) => {
    const profile = createProfile({
      operationSources: {
        sourceCount: scenario.sources,
      } as WebOperationSources,
      successfulSearchCount: scenario.searches,
    });
    const guard = profile.createOutputGuard!({
      command: { ...command, mode: 'deep_research' },
      turn,
    });

    await guard.push(scenario.report);
    await expect(guard.finish()).resolves.toMatchObject({
      kind: 'block',
      failureCode: 'RESEARCH_REQUIREMENTS_UNMET',
      publicContent: expect.stringContaining('研究材料不足'),
    });
  });

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

  it('输出偏好只强化本轮提示而不改变可信 Tool grant', async () => {
    const normal = await createProfile().prepare({ command, turn });
    const interactive = await createProfile({
      outputPreference: 'interactive_artifact',
    }).prepare({
      command,
      turn,
    });
    const interactiveSystemPrompt =
      interactive.context.profile[0]?.message.content ?? '';

    expect(interactiveSystemPrompt).toContain('思维导图');
    expect(interactiveSystemPrompt).toContain('Canvas');
    expect(interactive.toolPolicy).toEqual(normal.toolPolicy);
  });

  it.each([
    ['auto', '自然语言回答'],
    ['markdown_document', 'Markdown 文档'],
    ['interactive_artifact', '可在 Canvas'],
    ['web_app', 'web_app'],
  ] as const)(
    '不同输出偏好仅影响提示词，不影响工具授权 (%s)',
    async (preference, expectedHint) => {
      const base = await createProfile().prepare({ command, turn });
      const hinted = await createProfile({
        outputPreference: preference,
      }).prepare({ command, turn });

      expect(hinted.context.profile[0]?.message.content).toContain(
        expectedHint,
      );
      expect(hinted.toolPolicy).toEqual(base.toolPolicy);
    },
  );
});

describe('WebGeneralProfile 原生图片输入', () => {
  const image = {
    versionId: 'version-1',
    mimeType: 'image/png' as const,
    data: 'iVBORw0KGgo=',
    resourcePath: null,
  };

  it('把多张图片合并进一条消息，不逐张占用 segment 名额', async () => {
    const plan = await createProfile({
      assetContext: {
        ...assetContext,
        nativeImages: [image, { ...image, versionId: 'version-2' }],
      },
    }).prepare({ command, turn });

    expect(plan.context.sourcesAndAssets).toHaveLength(1);
    expect(plan.context.sourcesAndAssets[0]?.message.content).toHaveLength(3);
  });

  it('多图合并段登记全部 Asset Version 且保持消息内顺序（R02 完整追溯）', async () => {
    const plan = await createProfile({
      assetContext: {
        ...assetContext,
        nativeImages: [
          { ...image, versionId: 'version-1' },
          { ...image, versionId: 'version-2' },
          { ...image, versionId: 'version-3' },
        ],
      },
    }).prepare({ command, turn });

    const segment = plan.context.sourcesAndAssets[0]!.segment as {
      assetVersionIds?: readonly string[];
      assetVersionId?: string;
    };
    expect(segment.assetVersionIds).toEqual([
      'version-1',
      'version-2',
      'version-3',
    ]);
    expect(segment.assetVersionId).toBeUndefined();
  });

  it('segment 文本与消息的文本投影逐字相等，否则会触发 Prompt 漂移守卫', async () => {
    /* Turn Application 用 modelMessageText(message) === segment.content 检测漂移
       （turn-application/helpers.ts）。这两处的占位符写法是绑定的。 */
    const plan = await createProfile({
      assetContext: { ...assetContext, nativeImages: [image] },
    }).prepare({ command, turn });

    const candidate = plan.context.sourcesAndAssets[0]!;
    expect(modelMessageText(candidate.message)).toBe(candidate.segment.content);
  });

  it('同一版本的多张派生图只登记唯一 Asset Version，part id 用 resourcePath 区分', async () => {
    const derivedA = {
      ...image,
      versionId: 'version-1',
      resourcePath: 'images/fig1.png',
    };
    const derivedB = {
      ...image,
      versionId: 'version-1',
      resourcePath: 'images/fig2.png',
    };
    const plan = await createProfile({
      assetContext: { ...assetContext, nativeImages: [derivedA, derivedB] },
    }).prepare({ command, turn });

    const segment = plan.context.sourcesAndAssets[0]!.segment as {
      id?: string;
      assetVersionIds?: readonly string[];
    };
    expect(segment.id).toBe(
      'asset-native:version-1:images/fig1.png,version-1:images/fig2.png',
    );
    expect(segment.assetVersionIds).toEqual(['version-1']);
  });

  it('没有原生图片时不产生任何额外 segment', async () => {
    const plan = await createProfile().prepare({ command, turn });

    expect(plan.context.sourcesAndAssets).toEqual([]);
  });
});
