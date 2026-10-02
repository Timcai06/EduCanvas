import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkerModelRuntime } from '../model-runtime.js';
import { createWorkerModelRuntime } from '../model-runtime.js';
import { generateArtifact } from './generate-artifact.js';

const { artifacts, turns, environment, version } = vi.hoisted(() => ({
  artifacts: {
    transitionGenerationJob: vi.fn(),
    getArtifact: vi.fn(),
    findVersionByGenerationJob: vi.fn(),
    getGenerationJob: vi.fn(),
    updateGenerationJobCheckpoint: vi.fn(),
    claimGenerationJobExecution: vi.fn(async () => ({
      executionGeneration: 1,
      checkpoint: {},
    })),
    appendVersionAndCompleteGenerationJob: vi.fn(),
  },
  turns: { listMessages: vi.fn() },
  environment: {
    EDUCANVAS_DEPLOYMENT_ENV: 'local',
    MODEL_GATEWAY_PROVIDER: 'deepseek',
    MODEL_GATEWAY_ALLOW_DEEPSEEK: 'true',
    MODEL_GATEWAY_BASE_URL: 'https://api.deepseek.com',
    MODEL_GATEWAY_API_KEY: 'fixture-key',
    MODEL_GATEWAY_PRIMARY_MODEL: 'deepseek-v4-pro',
    MODEL_GATEWAY_STRUCTURED_MODEL: 'deepseek-v4-pro',
    MODEL_GATEWAY_STRUCTURED_MAX_OUTPUT_TOKENS: '8192',
  },
  version: { version: 1 },
}));

vi.mock('@educanvas/db', () => ({
  ArtifactJobLifecycleError: class extends Error {},
  AssetAccessError: class extends Error {},
  DrizzleAssetRepository: vi.fn(),
  DrizzlePlatformArtifactRepository: vi.fn(function () {
    return artifacts;
  }),
  DrizzlePlatformTurnRepository: vi.fn(function () {
    return turns;
  }),
}));

vi.mock('../model-runtime.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../model-runtime.js')>();
  return {
    ...original,
    createWorkerModelRuntime: vi.fn(original.createWorkerModelRuntime),
    readModelGatewayEnvironment: vi.fn(() => environment),
  };
});

vi.mock('./image-artifact-generation.js', () => ({
  ImageArtifactGenerationFailure: class extends Error {},
  appendGeneratedImageVersion: vi.fn(async () => version),
}));
vi.mock('./audio-artifact-generation.js', () => ({
  AudioArtifactGenerationFailure: class extends Error {},
  appendAudioOverviewVersion: vi.fn(async () => version),
}));
vi.mock('./picturebook-task.js', () => ({
  runPicturebookGenerationTask: vi.fn(
    async (input: { getRuntime: () => WorkerModelRuntime }) => {
      input.getRuntime();
      return version;
    },
  ),
}));

const JOB_ID = '11111111-1111-4111-8111-111111111111';
const ARTIFACT_ID = '22222222-2222-4222-8222-222222222222';

beforeEach(() => {
  vi.clearAllMocks();
  artifacts.transitionGenerationJob.mockResolvedValue({});
  artifacts.findVersionByGenerationJob.mockResolvedValue(null);
  artifacts.getGenerationJob.mockResolvedValue({
    id: JOB_ID,
    params: {},
    operationId: null,
  });
  artifacts.claimGenerationJobExecution.mockResolvedValue({
    executionGeneration: 1,
    checkpoint: {},
  });
  turns.listMessages.mockResolvedValue([
    { role: 'user', content: 'fixture topic' },
  ]);
});
afterEach(() => vi.unstubAllGlobals());

describe('generateArtifact selects a task-scoped output budget', () => {
  it.each([
    ['markdown_document', 'long_artifact', 1024],
    ['slides', 'long_artifact', 32768],
    ['web_app', 'long_artifact', 32768],
    ['mind_map', 'configured', 8192],
    ['flashcards', 'configured', 8192],
    ['note', 'configured', 8192],
    ['generated_image', 'configured', null],
    ['audio_overview', 'configured', null],
    ['picturebook', 'configured', null],
  ] as const)('%s uses %s', async (kind, outputBudget, maxTokens) => {
    artifacts.getArtifact.mockResolvedValue({
      id: ARTIFACT_ID,
      kind,
      title: 'fixture artifact',
      conversationId: '33333333-3333-4333-8333-333333333333',
      latestVersion: 0,
    });
    // 截断响应在 schema 校验前失败，捕获真实生成器请求且无需伪造各产物内容。
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({
        choices: [{ finish_reason: 'length', message: { content: '{' } }],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await generateArtifact(
      { jobId: JOB_ID, artifactId: ARTIFACT_ID, subjectId: 'fixture-subject' },
      {
        job: { attempts: 1, max_attempts: 3 },
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      } as never,
    );
    expect(createWorkerModelRuntime).toHaveBeenCalledExactlyOnceWith(
      environment,
      outputBudget,
    );
    if (maxTokens === null) {
      expect(fetchMock).not.toHaveBeenCalled();
      return;
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.model).toBe('deepseek-v4-pro');
    expect(body.max_tokens).toBe(maxTokens);
    expect(
      artifacts.appendVersionAndCompleteGenerationJob,
    ).not.toHaveBeenCalled();
    expect(artifacts.transitionGenerationJob).toHaveBeenLastCalledWith(
      expect.objectContaining({
        to: 'failed',
        failureCode: 'model_output_limit',
      }),
    );
  });

  it('分段内容checkpoint可恢复，且只提交完整聚合版本', async () => {
    artifacts.getArtifact.mockResolvedValue({
      id: ARTIFACT_ID,
      kind: 'markdown_document',
      title: '长文测试',
      conversationId: '33333333-3333-4333-8333-333333333333',
      latestVersion: 0,
    });
    const responses = [
      {
        sourceSummary: '函数定义来源',
        sections: [
          { title: '函数定义', focus: '变量与函数值' },
          { title: '实例', focus: '代入示例' },
        ],
      },
      { markdown: '- f(x)=x+1', continuationSummary: '已定义函数并给出表达式' },
      { markdown: '- 当 x=2 时 f(x)=3', continuationSummary: '实例已完成' },
    ];
    const fetchMock = vi.fn<typeof fetch>(async () => {
      const output = responses.shift();
      if (!output) throw new Error('unexpected provider call');
      return Response.json({
        choices: [
          {
            finish_reason: 'stop',
            message: { content: JSON.stringify(output) },
          },
        ],
        usage: { prompt_tokens: 30, completion_tokens: 15 },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    await generateArtifact(
      { jobId: JOB_ID, artifactId: ARTIFACT_ID, subjectId: 'fixture-subject' },
      {
        job: { attempts: 1, max_attempts: 3 },
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      } as never,
    );

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(artifacts.claimGenerationJobExecution).toHaveBeenCalledOnce();
    expect(
      fetchMock.mock.calls.map(
        (call) => JSON.parse(String(call[1]?.body)).max_tokens,
      ),
    ).toEqual([1024, 16_376, 32_738]);
    expect(artifacts.updateGenerationJobCheckpoint).toHaveBeenCalledTimes(6);
    expect(
      artifacts.updateGenerationJobCheckpoint.mock.calls.every(
        ([input]) => input.executionGeneration === 1,
      ),
    ).toBe(true);
    expect(artifacts.updateGenerationJobCheckpoint).toHaveBeenLastCalledWith(
      expect.objectContaining({
        checkpoint: expect.objectContaining({
          stage: 'markdown-longform-v2',
          usage: expect.objectContaining({ outputTokens: 45 }),
          completedSections: [
            expect.objectContaining({ index: 0, markdown: '- f(x)=x+1' }),
            expect.objectContaining({
              index: 1,
              markdown: '- 当 x=2 时 f(x)=3',
            }),
          ],
        }),
      }),
    );
    expect(
      artifacts.appendVersionAndCompleteGenerationJob,
    ).toHaveBeenCalledTimes(1);
    expect(
      artifacts.appendVersionAndCompleteGenerationJob,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        executionGeneration: 1,
        content: expect.objectContaining({
          markdown: expect.stringContaining('## 实例\n\n- 当 x=2 时 f(x)=3'),
        }),
      }),
    );
  });
});
