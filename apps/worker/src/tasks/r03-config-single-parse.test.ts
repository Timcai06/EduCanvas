import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelGatewayEnvironment } from '@educanvas/model-gateway';
import { generateArtifact } from './generate-artifact';
import { createEmbedKnowledgeDocumentTask } from './embed-knowledge-document';

/**
 * R03 spy 回归：真实任务调用路径的 `parseModelGatewayConfiguration` 次数。
 *
 * - generate-artifact 的 audio_overview 分支（structured + speech 两个能力）
 *   必须只解析一次环境（迁移到 createWorkerModelRuntime 后）；
 * - embed-knowledge-document 未注入路径（embedding gateway 与 identity）
 *   必须共享同一已验证配置（一次解析）。
 *
 * 只计数纯函数调用，不引入全局可变缓存；spy 转发原实现，环境由本文件
 * 通过 process.env 显式转交（真实 readModelGatewayEnvironment 路径）。
 */

const { parseSpy } = vi.hoisted(() => ({ parseSpy: vi.fn() }));

// 注意：不能同时 mock './config' 与 '@educanvas/model-gateway'——后者 factory
// 的 importOriginal 会加载真实 index.ts，绕过 config mock。改为在
// model-gateway mock 内包装 parseModelGatewayConfiguration（转发原实现，
// 只计数），并替换 speech Gateway 类为 fake（parse 仍走真实逻辑）。
vi.mock('@educanvas/model-gateway', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@educanvas/model-gateway')>();
  return {
    ...original,
    parseModelGatewayConfiguration: (environment: ModelGatewayEnvironment) => {
      parseSpy(environment);
      return original.parseModelGatewayConfiguration(environment);
    },
    OpenAICompatibleSpeechModelGateway: vi.fn(function () {
      return {
        generateSpeech: vi.fn().mockResolvedValue({
          bytes: new Uint8Array([1, 2, 3]),
          contentType: 'audio/mpeg',
          voice: 'alloy',
          metadata: {
            provider: 'fixture',
            resolvedModelId: 'speech-model',
            latencyMs: 10,
          },
        }),
      };
    }),
  };
});

const {
  repository,
  turnsRepository,
  assetGateway,
  generateAudioOverviewScript,
  embeddingRepository,
} = vi.hoisted(() => ({
  repository: {
    transitionGenerationJob: vi.fn(),
    getArtifact: vi.fn(),
    findVersionByGenerationJob: vi.fn(),
    getGenerationJob: vi.fn(),
    appendVersionAndCompleteGenerationJob: vi.fn(),
    updateGenerationJobCheckpoint: vi.fn(),
  },
  turnsRepository: { listMessages: vi.fn() },
  assetGateway: { materializeOwnedReferences: vi.fn() },
  generateAudioOverviewScript: vi.fn(),
  embeddingRepository: {
    createOrGetRun: vi.fn().mockResolvedValue(undefined),
    listPendingChunks: vi.fn().mockResolvedValue([]),
    writeEmbeddings: vi.fn().mockResolvedValue(undefined),
    settleRun: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@educanvas/db', () => ({
  ArtifactJobLifecycleError: class ArtifactJobLifecycleError extends Error {
    constructor(from: string, to: string) {
      super(`artifact transition ${from} => ${to}`);
      this.name = 'ArtifactJobLifecycleError';
    }
  },
  AssetAccessError: class AssetAccessError extends Error {
    constructor() {
      super('asset access denied');
      this.name = 'AssetAccessError';
    }
  },
  DrizzleAssetRepository: vi.fn(function () {
    return assetGateway;
  }),
  DrizzlePlatformArtifactRepository: vi.fn(function () {
    return repository;
  }),
  DrizzlePlatformTurnRepository: vi.fn(function () {
    return turnsRepository;
  }),
  DrizzleKnowledgeEmbeddingRepository: vi.fn(function () {
    return embeddingRepository;
  }),
}));

vi.mock('@educanvas/agent-runtime', () => ({
  LocalObjectStorage: vi.fn(function () {
    return {
      put: vi.fn().mockResolvedValue({
        key: 'artifacts/x',
        size: 3,
        checksum: 'a'.repeat(64),
        contentType: 'audio/mpeg',
      }),
      readVerified: vi.fn(),
      delete: vi.fn(),
    };
  }),
}));

vi.mock('./audio-overview-generation.js', () => ({
  generateAudioOverviewScript,
  AUDIO_OVERVIEW_PROMPT_VERSION: 'audio-overview-v1',
  AUDIO_OVERVIEW_RULE_GENERATOR: 'rule:audio-overview-script-v1',
  AUDIO_OVERVIEW_MODEL_GENERATOR: 'model:audio-overview-script-v1',
}));

const JOB_ID = '11111111-1111-4111-8111-111111111111';
const ARTIFACT_ID = '22222222-2222-4222-8222-222222222222';
const SUBJECT_ID = 'student-1';
const CONVERSATION_ID = '33333333-3333-4333-8333-333333333333';
const SPACE_ID = '44444444-4444-4444-9444-444444444444';

/** openai-compatible 主配置 + speech override：使 audio_overview 分支可跑通。 */
function setAudioEnvironment(): void {
  process.env.EDUCANVAS_DEPLOYMENT_ENV = 'local';
  process.env.MODEL_GATEWAY_PROVIDER = 'openai-compatible';
  process.env.MODEL_GATEWAY_BASE_URL = 'https://primary.invalid/v1';
  process.env.MODEL_GATEWAY_API_KEY = 'primary-fixture-key';
  process.env.MODEL_GATEWAY_PRIMARY_MODEL = 'primary-text-model';
  process.env.MODEL_GATEWAY_SPEECH_PROVIDER = 'openai-compatible';
  process.env.MODEL_GATEWAY_SPEECH_MODEL = 'speech-model';
  process.env.MODEL_GATEWAY_SPEECH_BASE_URL = 'https://speech.invalid/v1';
  process.env.MODEL_GATEWAY_SPEECH_API_KEY = 'speech-fixture-key';
}

function clearModelEnvironment(): void {
  for (const key of Object.keys(process.env)) {
    if (
      key.startsWith('MODEL_GATEWAY_') ||
      key === 'EDUCANVAS_DEPLOYMENT_ENV'
    ) {
      delete process.env[key];
    }
  }
}

const audioArtifact = {
  id: ARTIFACT_ID,
  spaceId: SPACE_ID,
  conversationId: CONVERSATION_ID,
  ownerSubjectId: SUBJECT_ID,
  kind: 'audio_overview' as const,
  trustTier: 'tier2' as const,
  title: '音频产物',
  status: 'active' as const,
  latestVersion: 0,
  createdAt: '2026-07-27T00:00:00.000Z',
  updatedAt: '2026-07-27T00:01:00.000Z',
};

beforeEach(() => {
  parseSpy.mockClear();
  repository.transitionGenerationJob.mockImplementation(
    async (input: { to: string }) => ({
      id: JOB_ID,
      artifactId: ARTIFACT_ID,
      operationId: null,
      status: input.to,
      progress: 5,
      failureCode: null,
      params: { selectedSources: [] },
      checkpoint: {},
      queueJobKey: 'artifact-generate',
    }),
  );
  repository.getArtifact.mockResolvedValue(audioArtifact);
  repository.findVersionByGenerationJob.mockResolvedValue(null);
  repository.getGenerationJob.mockResolvedValue({
    id: JOB_ID,
    artifactId: ARTIFACT_ID,
    operationId: null,
    status: 'running',
    progress: 5,
    failureCode: null,
    params: {
      selectedSources: [
        { assetId: 'a1', versionId: 'v1', kind: 'document' },
        { assetId: 'a2', versionId: 'v1', kind: 'document' },
      ],
    },
    checkpoint: {},
    queueJobKey: 'artifact-generate',
  });
  assetGateway.materializeOwnedReferences.mockResolvedValue([
    { displayName: '资料一', extractedText: '第一份资料内容' },
    { displayName: '资料二', extractedText: '第二份资料内容' },
  ]);
  generateAudioOverviewScript.mockResolvedValue({
    script: '音频脚本内容',
    audit: {},
  });
  repository.updateGenerationJobCheckpoint.mockResolvedValue(undefined);
  repository.appendVersionAndCompleteGenerationJob.mockResolvedValue({
    id: 'v1',
    artifactId: ARTIFACT_ID,
    version: 1,
    content: null,
    metadata: {},
    objectKey: 'artifacts/x',
    checksum: 'a'.repeat(64),
    createdByOperationId: null,
    generatedBy: 'model:speech.generate:audio-overview-v1',
    generationJobId: JOB_ID,
    createdAt: '2026-07-27T00:02:00.000Z',
  });
  turnsRepository.listMessages.mockResolvedValue([]);
});

afterEach(() => {
  clearModelEnvironment();
});

const taskHelpers = () =>
  ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    job: { attempts: 1, max_attempts: 3 },
  }) as never;

describe('R03：真实任务调用路径单次解析', () => {
  it('generate-artifact audio_overview 分支（structured+speech 两个能力）只解析一次环境', async () => {
    setAudioEnvironment();
    await generateArtifact(
      {
        jobId: JOB_ID,
        artifactId: ARTIFACT_ID,
        subjectId: SUBJECT_ID,
      },
      taskHelpers(),
    );
    // 迁移后（createWorkerModelRuntime）：1 次。
    expect(parseSpy).toHaveBeenCalledTimes(1);
    expect(generateAudioOverviewScript).toHaveBeenCalledTimes(1);
  });

  it('embed-knowledge-document 未注入路径（embedding 与 identity）只解析一次环境', async () => {
    clearModelEnvironment();
    await createEmbedKnowledgeDocumentTask({})(
      {
        documentId: '11111111-1111-4111-8111-111111111111',
        chunkingVersion: 'parser-v1',
      },
      taskHelpers(),
    );
    // 迁移前：resolveEmbeddingRuntimeIdentity + resolveEmbeddingModelGateway
    // 各一次 = 2 次；迁移后（共享 runtime）：1 次。
    expect(parseSpy).toHaveBeenCalledTimes(1);
  });
});
