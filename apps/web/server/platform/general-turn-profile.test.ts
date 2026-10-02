import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { webGeneralTurns } from './general-turn-persistence';
import { loadGeneralArtifactStatusContext } from './general-turn-artifact-context';
import type { WebOperationArtifacts } from './general-artifact-tool';
import type { WebOperationSources } from './general-turn-tools';
import {
  createNodeInvocations,
  createProfile,
  command,
  turn,
} from './general-turn-profile.test-support';

vi.mock('server-only', () => ({}));
vi.mock('./general-turn-artifact-context', () => ({
  loadGeneralArtifactStatusContext: vi
    .fn()
    .mockResolvedValue('historical artifact status snapshot'),
}));

beforeEach(() => {
  vi.spyOn(webGeneralTurns, 'listMessages').mockResolvedValue([]);
  vi.mocked(loadGeneralArtifactStatusContext).mockClear();
  process.env.EDUCANVAS_DEPLOYMENT_ENV = 'test';
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.EDUCANVAS_DEPLOYMENT_ENV;
});

describe('WebGeneralProfile trusted Tool Policy', () => {
  it('Deep Research 复用同一 Profile Port，并为失败补位保留 6 个工具轮次', async () => {
    const plan = await createProfile({
      staticToolCapabilities: ['artifact.read'],
    }).prepare({
      command: { ...command, mode: 'deep_research' },
      turn,
    });
    const prompt = plan.context.profile[0]?.message.content ?? '';

    expect(plan.model.maxToolRounds).toBe(6);
    expect(plan.context.maxCharacters).toBe(128_000);
    expect(plan.model.usageBudget?.maxToolCalls).toBe(16);
    expect(plan.model.usageBudget?.maxToolResultTokens).toBe(8_000);
    expect(loadGeneralArtifactStatusContext).not.toHaveBeenCalled();
    expect(prompt).toContain('至少完成三轮');
    expect(prompt).toContain('分析证据缺口');
    expect(prompt).toContain('最多两轮替代查询');
    expect(prompt).toContain('关键结论与证据');
    expect(prompt).toContain('不得引用搜索摘要');
    expect(prompt).not.toContain('getCanvasArtifactStatus');
  });

  it('有历史 artifactId 时要求用只读状态工具刷新，不依据旧快照判断完成', async () => {
    const plan = await createProfile({
      staticToolCapabilities: ['artifact.read'],
    }).prepare({ command, turn });
    const prompt = plan.context.profile[0]?.message.content ?? '';

    expect(prompt).toContain('getCanvasArtifactStatus');
    expect(prompt).toContain('只按本轮回执回答');
    expect(prompt).toContain('inconsistent');
    expect(plan.toolPolicy?.capabilities.actor).toContain('artifact.read');
    expect(loadGeneralArtifactStatusContext).toHaveBeenCalledTimes(1);
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
    expect('toolRemediation' in guard).toBe(true);
    if ('toolRemediation' in guard) {
      expect(guard.toolRemediation).toMatchObject({ tool: 'webSearch' });
    }
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
      publicContent: expect.stringContaining('未达到可核验报告要求'),
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
        finalizeConfirmation: vi.fn().mockResolvedValue(null),
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

    expect(interactiveSystemPrompt).toContain('Canvas');
    expect(interactive.toolPolicy).toEqual(normal.toolPolicy);
  });

  it.each([
    ['auto', '不支持产物确认卡片'],
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
