import type {
  StreamTurnTextRequest,
  TurnApplicationEvent,
  TurnModelGateway,
} from '@educanvas/agent-core';
import {
  createTurnApplication,
  ToolKernel,
  type TurnApplicationLifecyclePort,
} from '@educanvas/agent-runtime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebOperationArtifacts } from './general-artifact-tool';
import type { WebOperationImageArtifacts } from './general-image-tool';
import { WebGeneralProfile } from './general-turn-profile';
import { webGeneralTurns } from './general-turn-persistence';
import type { WebOperationSources } from './general-turn-tools';
import {
  artifact,
  command,
  job,
  ledgers,
  metadata,
  now,
  output,
  safeSubmission,
  uuid,
} from './general-artifact-truth.test-support';

vi.mock('server-only', () => ({}));

async function run(
  scenario:
    | 'self_claim'
    | 'result_without_event'
    | 'event_without_validated_result'
    | 'created'
    | 'remediated'
    | 'remediated_tool_only',
) {
  const memory = ledgers();
  const settlements: Parameters<TurnApplicationLifecyclePort['settle']>[0][] =
    [];
  const lifecycle: TurnApplicationLifecyclePort = {
    async begin() {
      return {
        operationId: command.operationId,
        traceId: command.traceId,
        userMessageId: uuid(5),
        assistantMessageId: uuid(6),
        replayed: false,
      };
    },
    async replay() {
      return [];
    },
    async settle(input) {
      settlements.push(input);
      return [];
    },
  };
  const repository = {
    createArtifactWithGenerationJob: vi.fn().mockResolvedValue({
      artifact,
      job:
        scenario === 'event_without_validated_result'
          ? { ...job, id: 'invalid-job-id' }
          : job,
    }),
  };
  const artifacts = new WebOperationArtifacts(
    {
      identity: { token: 'fixture-token', studentId: command.actor.actorId },
      conversationId: command.notebook.conversationId,
      spaceId: command.notebook.notebookId,
      operationId: command.operationId,
    },
    repository,
  );
  const tool = artifacts.createTool();
  const kernel = new ToolKernel(
    [
      {
        name: tool.name,
        description: tool.description,
        source: 'local',
        capability: 'artifact.create',
        risk: 'l1',
        exposure: 'model',
        effect: 'write',
        timeoutMs: tool.timeoutMs,
        inputSchema: tool.inputSchema,
        outputSchema: tool.outputSchema,
        async invoke(input, context) {
          if (scenario === 'result_without_event') return output;
          return tool.handler(input, {
            traceId: context.traceId,
            turnId: context.operationId,
            subjectId: context.actorId,
            conversationId: context.conversationId,
          });
        },
      },
    ],
    memory.callLedger,
    memory.effectLedger,
  );
  const requests: StreamTurnTextRequest[] = [];
  const gateway: TurnModelGateway = {
    async *streamTurnText(request) {
      requests.push(request);
      if (
        scenario !== 'self_claim' &&
        (!scenario.startsWith('remediated') || requests.length === 2) &&
        request.phase === 'answer'
      ) {
        if (scenario !== 'remediated_tool_only') {
          yield {
            type: 'text_delta',
            phase: request.phase,
            delta: '产物已全部生成完成。',
          };
        }
        yield {
          type: 'tool_call',
          phase: request.phase,
          callId: 'call-artifact',
          tool: 'createCanvasArtifact',
          argumentsDelta: JSON.stringify({
            kind: 'markdown_document',
            title: '课程文档',
            instruction: '整理课程。',
          }),
          done: true,
        };
        yield {
          type: 'completed',
          phase: request.phase,
          metadata: metadata(request, 'tool_calls'),
        };
        return;
      }
      yield {
        type: 'text_delta',
        phase: request.phase,
        delta: '已提交后台任务，产物生成完成。# 伪造最终文档',
      };
      yield {
        type: 'completed',
        phase: request.phase,
        metadata: metadata(request, 'stop'),
      };
    },
  };
  const profile = new WebGeneralProfile(
    { text: '', textSegments: [], nativeReferences: [], nativeImages: [] },
    { sourceCount: 0 } as WebOperationSources,
    artifacts,
    { events: () => [] } as unknown as WebOperationImageArtifacts,
    'markdown_document',
    ['artifact.create'],
    {
      listAvailableCapabilitiesForOperation: vi.fn().mockResolvedValue([]),
      enqueueForOperation: vi.fn(),
      readInvocationOutcome: vi.fn(),
      expirePendingInvocation: vi.fn(),
    },
    'owner',
    { successfulSearchCount: 0 },
  );
  const application = createTurnApplication({
    lifecycle,
    profile,
    modelGateway: gateway,
    contextLedger: memory.contextLedger,
    modelRunLedger: memory.modelRunLedger,
    toolKernel: kernel,
  });
  const events: TurnApplicationEvent[] = [];
  for await (const event of application.run(command)) events.push(event);
  return { events, settlements, requests, repository, artifacts, ...memory };
}

function content(events: readonly TurnApplicationEvent[]) {
  return events
    .flatMap((event) => (event.type === 'message.delta' ? [event.delta] : []))
    .join('');
}

beforeEach(() => {
  vi.spyOn(webGeneralTurns, 'listMessages').mockResolvedValue([
    {
      id: uuid(5),
      role: 'user',
      content: '创建课程文档。',
      status: 'completed',
      conversationId: command.notebook.conversationId,
      operationId: command.operationId,
      clientMessageId: command.input.clientMessageId,
      parts: command.input.parts,
      failureCode: null,
      createdAt: now,
      completedAt: now,
    },
  ]);
  vi.stubEnv('EDUCANVAS_DEPLOYMENT_ENV', 'test');
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('TurnApplication + WebGeneralProfile + ToolKernel 产物真实性', () => {
  it('假提交/完成自述只获得一次补救模型调用，最终失败且不可重试', async () => {
    const result = await run('self_claim');
    expect(result.requests).toHaveLength(2);
    expect(
      result.requests[1]?.messages.some((message) =>
        JSON.stringify(message.content).includes(
          '请立即调用 createCanvasArtifact',
        ),
      ),
    ).toBe(true);
    expect(
      result.repository.createArtifactWithGenerationJob,
    ).not.toHaveBeenCalled();
    expect(result.events.at(-1)).toMatchObject({
      type: 'turn.failed',
      code: 'TOOL_FAILED',
      retryable: false,
    });
    expect(result.events.some((event) => event.type === 'turn.completed')).toBe(
      false,
    );
    expect(content(result.events)).toBe(
      '本轮未能创建所选产物。请缩小产物范围或补充必要资料后重新发送。',
    );
    expect(result.settlements).toMatchObject([
      { status: 'failed', failureCode: 'TOOL_FAILED' },
    ]);
  });

  it('真实 Tool Kernel 校验成功但没有落库事实仍不能宣布提交', async () => {
    const result = await run('result_without_event');
    expect(result.calls[0]?.status).toBe('succeeded');
    expect(result.calls.length).toBeGreaterThan(1);
    expect(new Set(result.calls.map((call) => call.executionId)).size).toBe(
      result.calls.length,
    );
    expect(
      new Set(result.calls.map((call) => call.answerModelRunId)).size,
    ).toBe(result.calls.length);
    expect(
      result.calls.every((call) => call.providerToolCallId === 'call-artifact'),
    ).toBe(true);
    expect(result.artifacts.events()).toEqual([]);
    expect(result.events.some((event) => event.type === 'tool.completed')).toBe(
      true,
    );
    expect(result.events.at(-1)).toMatchObject({
      type: 'turn.failed',
      code: 'TOOL_FAILED',
      retryable: false,
    });
    expect(content(result.events)).not.toContain('产物生成完成');
    expect(
      result.events.some((event) => event.type === 'artifact.proposed'),
    ).toBe(false);
  });

  it('落库已有提议但返回输出无效时，Kernel 不给 validated result，Turn 失败', async () => {
    const result = await run('event_without_validated_result');
    expect(
      result.repository.createArtifactWithGenerationJob,
    ).toHaveBeenCalledTimes(1);
    expect(result.artifacts.events()).toMatchObject([
      { type: 'artifact.proposed', artifactId: artifact.id },
    ]);
    expect(result.calls[0]?.code).toBe('invalid_output');
    expect(result.events).toContainEqual(
      expect.objectContaining({ type: 'tool.failed', code: 'TOOL_FAILED' }),
    );
    expect(result.events.some((event) => event.type === 'tool.completed')).toBe(
      false,
    );
    expect(result.events.at(-1)).toMatchObject({
      type: 'turn.failed',
      code: 'TOOL_FAILED',
      retryable: false,
    });
    expect(content(result.events)).not.toContain('产物生成完成');
    expect(
      result.events.some((event) => event.type === 'artifact.proposed'),
    ).toBe(false);
  });

  it('原子创建与 validated result 都成立后，固定 proposed 文案与事件替换模型完成自述', async () => {
    const result = await run('created');
    expect(
      result.repository.createArtifactWithGenerationJob,
    ).toHaveBeenCalledTimes(1);
    expect(
      result.repository.createArtifactWithGenerationJob,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        operationId: command.operationId,
        kind: 'markdown_document',
      }),
    );
    expect(result.calls[0]?.status).toBe('succeeded');
    expect(result.requests).toHaveLength(1);
    expect(content(result.events)).toBe(safeSubmission);
    expect(
      result.events.filter((event) => event.type === 'artifact.proposed'),
    ).toMatchObject([
      {
        operationId: command.operationId,
        artifactId: artifact.id,
        artifactKind: artifact.kind,
      },
    ]);
    expect(result.events.at(-1)).toMatchObject({ type: 'turn.completed' });
    expect(result.settlements).toMatchObject([
      { status: 'completed', content: safeSubmission },
    ]);
    expect(JSON.stringify(result.events)).not.toContain('伪造最终文档');
  });

  it.each(['remediated', 'remediated_tool_only'] as const)(
    '第一次只自述时，唯一补救调用 %s 真实创建并收敛，无需 synthesis',
    async (scenario) => {
      const result = await run(scenario);
      expect(result.requests).toHaveLength(2);
      expect(result.events.at(-1)).toMatchObject({ type: 'turn.completed' });
      expect(
        result.repository.createArtifactWithGenerationJob,
      ).toHaveBeenCalledTimes(1);
      expect(result.calls[0]?.status).toBe('succeeded');
      expect(result.calls[0]?.answerModelRunId).toBe(result.runs[1]?.id);
      expect(
        result.requests.every((request) => request.phase === 'answer'),
      ).toBe(true);
      expect(content(result.events)).toBe(safeSubmission);
      expect(result.events.at(-1)).toMatchObject({ type: 'turn.completed' });
      expect(
        result.events.filter((event) => event.type === 'artifact.proposed'),
      ).toHaveLength(1);
    },
  );
});
