import type {
  ModelToolResult,
  OutputPreference,
  TurnApplicationCommand,
} from '@educanvas/agent-core';
import type {
  TurnApplicationLifecycleSnapshot,
  TurnApplicationOutputGuardPort,
  TurnApplicationProfileEvent,
} from '@educanvas/agent-runtime';
import type { NodeInvocationPersistencePort } from '@educanvas/node-runtime';
import { describe, expect, it, vi } from 'vitest';
import { ArtifactOutputGuard } from './general-artifact-output-guard';
import type { WebOperationArtifacts } from './general-artifact-tool';
import type { WebOperationImageArtifacts } from './general-image-tool';
import { WebGeneralProfile } from './general-turn-profile';
import type { WebOperationSources } from './general-turn-tools';

vi.mock('server-only', () => ({}));

const operationId = '00000000-0000-4000-8000-000000000001';
const artifactId = '00000000-0000-4000-8000-000000000002';
const jobId = '00000000-0000-4000-8000-000000000003';
const proposed: TurnApplicationProfileEvent = {
  protocol: 'educanvas.turn.v2',
  operationId,
  type: 'artifact.proposed',
  artifactId,
  artifactKind: 'markdown_document',
  trustTier: 'tier1',
  title: '课程文档',
};
const result: ModelToolResult = {
  callId: 'call-artifact',
  tool: 'createCanvasArtifact',
  arguments: {
    kind: 'markdown_document',
    title: '课程文档',
    instruction: '整理课程。',
  },
  output: {
    artifactId,
    jobId,
    kind: 'markdown_document',
    title: '课程文档',
    status: 'proposed',
  },
};
const safeSubmission =
  '产物任务已提交，正在后台生成。请在 Canvas 中查看实际进度和结果。';

function artifacts(events: readonly TurnApplicationProfileEvent[]) {
  return { events: () => events } as WebOperationArtifacts;
}

describe('ArtifactOutputGuard 对抗性真实性校验', () => {
  it.each(['markdown_document', 'interactive_artifact', 'web_app'] as const)(
    '%s 丢弃模型自述、正文与分片 JSON，未有事实时稳定失败',
    async (preference) => {
      const guard = new ArtifactOutputGuard(
        preference,
        artifacts([]),
        operationId,
      );
      for (const delta of [
        '已提交后台任务。',
        'Canvas 已生成完成，可立即使用。',
        '# 课程文档\n这是聊天里的文档替代品。',
        '{"tool":"createCanvasArtifact",',
        '"output":{"status":"proposed"}}',
      ]) {
        await expect(guard.push(delta)).resolves.toEqual({ kind: 'hold' });
      }
      expect(guard.completionRequirement.isSatisfied([])).toBe(false);
      await expect(guard.finish()).resolves.toEqual({
        kind: 'block',
        publicContent:
          '本轮未能创建所选产物。请缩小产物范围或补充必要资料后重新发送。',
        failureCode: 'TOOL_FAILED',
      });
    },
  );

  it('只有工具调用/已验证格式结果，没有落库事件不能满足创建', async () => {
    const guard = new ArtifactOutputGuard(
      'markdown_document',
      artifacts([]),
      operationId,
    );
    expect(guard.completionRequirement.isSatisfied([result])).toBe(false);
    await expect(guard.finish()).resolves.toMatchObject({
      kind: 'block',
      failureCode: 'TOOL_FAILED',
    });
  });

  it.each(
    [
      [],
      [{ ...result, tool: 'webSearch' }],
      [
        {
          ...result,
          output: { artifactId, kind: 'markdown_document', status: 'proposed' },
        },
      ],
      [
        {
          ...result,
          output: { ...(result.output as object), status: 'completed' },
        },
      ],
      [
        {
          ...result,
          output: { ...(result.output as object), jobId: 'not-a-uuid' },
        },
      ],
      [
        {
          ...result,
          output: { ...(result.output as object), claimedCompleted: true },
        },
      ],
    ].map((results) => ({ results })),
  )(
    '只有落库事件，缺少有效 createCanvasArtifact 输出仍拒绝 %#',
    async ({ results }) => {
      const guard = new ArtifactOutputGuard(
        'markdown_document',
        artifacts([proposed]),
        operationId,
      );
      expect(guard.completionRequirement.isSatisfied(results)).toBe(false);
      await expect(guard.finish()).resolves.toMatchObject({
        kind: 'block',
        failureCode: 'TOOL_FAILED',
      });
    },
  );

  it.each([
    { ...proposed, operationId: 'other-operation' },
    { ...proposed, artifactId: '00000000-0000-4000-8000-000000000009' },
    { ...proposed, artifactKind: 'web_app' },
  ])('事件 operation、artifact id 或 kind 错配拒绝 %#', (event) => {
    const guard = new ArtifactOutputGuard(
      'markdown_document',
      artifacts([event]),
      operationId,
    );
    expect(guard.completionRequirement.isSatisfied([result])).toBe(false);
  });

  it.each([
    ['markdown_document', 'mind_map'],
    ['web_app', 'markdown_document'],
    ['interactive_artifact', 'markdown_document'],
    ['interactive_artifact', 'web_app'],
  ] as const)('%s 拒绝匹配事件但不符合偏好的 %s', (preference, kind) => {
    const guard = new ArtifactOutputGuard(
      preference,
      artifacts([{ ...proposed, artifactKind: kind }]),
      operationId,
    );
    expect(
      guard.completionRequirement.isSatisfied([
        { ...result, output: { ...(result.output as object), kind } },
      ]),
    ).toBe(false);
  });

  it.each([
    ['markdown_document', 'markdown_document'],
    ['web_app', 'web_app'],
    ['interactive_artifact', 'mind_map'],
    ['interactive_artifact', 'slides'],
    ['interactive_artifact', 'flashcards'],
    ['interactive_artifact', 'note'],
    ['interactive_artifact', 'picturebook'],
  ] as const)(
    '%s 有可信 %s 提议时只公开固定后台提交文案',
    async (preference, kind) => {
      const guard = new ArtifactOutputGuard(
        preference,
        artifacts([{ ...proposed, artifactKind: kind }]),
        operationId,
      );
      expect(
        guard.completionRequirement.isSatisfied([
          { ...result, output: { ...(result.output as object), kind } },
        ]),
      ).toBe(true);
      await expect(
        guard.push('产物已完成。\n这是最终 HTML/Markdown 内容。'),
      ).resolves.toEqual({ kind: 'hold' });
      await expect(guard.finish()).resolves.toEqual({
        kind: 'emit',
        safeDeltas: [safeSubmission],
      });
    },
  );
});

const command: TurnApplicationCommand = {
  protocol: 'educanvas.turn.v2',
  operationId,
  traceId: 'trace-guard',
  actor: {
    actorId: 'actor-1',
    agentId: '00000000-0000-4000-8000-000000000004',
  },
  notebook: {
    notebookId: '00000000-0000-4000-8000-000000000005',
    conversationId: '00000000-0000-4000-8000-000000000006',
  },
  profile: { profileId: 'general' },
  entrypoint: 'web',
  input: {
    clientMessageId: 'client-1',
    parts: [{ type: 'text', text: '整理课程。' }],
  },
  capabilities: [],
};
const turn: TurnApplicationLifecycleSnapshot = {
  operationId,
  traceId: command.traceId,
  userMessageId: 'user-message',
  assistantMessageId: 'assistant-message',
  replayed: false,
};

function profile(preference: OutputPreference, searches = 0, sources = 0) {
  return new WebGeneralProfile(
    { text: '', textSegments: [], nativeReferences: [], nativeImages: [] },
    { sourceCount: sources } as WebOperationSources,
    artifacts([]),
    { events: () => [] } as unknown as WebOperationImageArtifacts,
    preference,
    [],
    {} as NodeInvocationPersistencePort,
    'owner',
    { successfulSearchCount: searches },
  );
}

describe('WebGeneralProfile 输出策略兼容性', () => {
  it('auto 仍直接流出正文且不要求创建产物', async () => {
    const guard: TurnApplicationOutputGuardPort = profile(
      'auto',
    ).createOutputGuard({ command, turn });
    expect(guard.completionRequirement).toBeUndefined();
    await expect(guard.push('普通对话正文。')).resolves.toEqual({
      kind: 'emit',
      safeDeltas: ['普通对话正文。'],
    });
    await expect(guard.finish()).resolves.toEqual({
      kind: 'emit',
      safeDeltas: [],
    });
  });

  it.each([
    'auto',
    'markdown_document',
    'interactive_artifact',
    'web_app',
  ] as const)(
    '深度研究在 %s 偏好下仍按研究证据放行报告，不要求 Canvas 创建',
    async (preference) => {
      const guard: TurnApplicationOutputGuardPort = profile(
        preference,
        3,
        5,
      ).createOutputGuard({
        command: { ...command, mode: 'deep_research' },
        turn,
      });
      const report = '# 摘要\n结论[1][2][3][4][5]。';
      expect(guard.completionRequirement).toBeUndefined();
      await expect(guard.push(report)).resolves.toEqual({ kind: 'hold' });
      await expect(guard.finish()).resolves.toEqual({
        kind: 'emit',
        safeDeltas: [report],
      });
    },
  );

  it('深度研究证据不足保持原研究失败码', async () => {
    const guard = profile('web_app', 2, 5).createOutputGuard({
      command: { ...command, mode: 'deep_research' },
      turn,
    });
    await guard.push('# 摘要\n结论[1][2][3][4][5]。');
    await expect(guard.finish()).resolves.toMatchObject({
      kind: 'block',
      failureCode: 'RESEARCH_REQUIREMENTS_UNMET',
    });
  });
});
