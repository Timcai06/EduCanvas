import { ModelGatewayInvocationError } from '@educanvas/agent-core';
import type { EmbeddingIdentity } from '@educanvas/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmbedKnowledgeDocumentTask } from './embed-knowledge-document';

const DOCUMENT_ID = '11111111-1111-4111-8111-111111111111';
const IDENTITY: EmbeddingIdentity = {
  embeddingModel: 'embed-model',
  embeddingModelVersion: '2026-05-01',
  instruction: 'passage:v1',
};

const DIMENSIONS = 1536;
const vectorOf = (seed: number) => new Array<number>(DIMENSIONS).fill(seed);

function createChunk(index: number) {
  return {
    chunkId: `chunk-${index}`,
    documentId: DOCUMENT_ID,
    chunkIndex: index,
    contentHash: 'a'.repeat(64),
    content: `切块内容 ${index}`,
    heading: index === 0 ? '第一节' : null,
  };
}

function createRepository() {
  return {
    createOrGetRun: vi.fn().mockResolvedValue({ replayed: false }),
    beginRun: vi.fn().mockResolvedValue({ totalChunkCount: 2 }),
    listPendingChunks: vi.fn(),
    writeEmbeddings: vi.fn().mockResolvedValue(undefined),
    settleRun: vi.fn().mockResolvedValue(undefined),
  };
}

function createGateway() {
  return {
    embed: vi.fn(async (request: { inputs: readonly string[] }) => ({
      embeddings: request.inputs.map((_input, index) => vectorOf(index / 10)),
      descriptor: { ...IDENTITY, provider: 'fixture', dimensions: DIMENSIONS },
      metadata: {},
    })),
  };
}

const helpers = (attempts = 1, maxAttempts = 3) =>
  ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    job: { attempts, max_attempts: maxAttempts },
  }) as never;

const payload = { documentId: DOCUMENT_ID, chunkingVersion: 'parser-v1' };

describe('knowledge:embed_document', () => {
  let repository: ReturnType<typeof createRepository>;
  let gateway: ReturnType<typeof createGateway>;

  beforeEach(() => {
    repository = createRepository();
    gateway = createGateway();
  });

  const run = (
    overrides: Partial<
      Parameters<typeof createEmbedKnowledgeDocumentTask>[0]
    > = {},
    attempts = 1,
    maxAttempts = 3,
  ) =>
    createEmbedKnowledgeDocumentTask({
      repository: repository as never,
      gateway: gateway as never,
      identity: IDENTITY,
      batchSize: 2,
      ...overrides,
    })(payload, helpers(attempts, maxAttempts));

  it('批量嵌入待办切块并在待办清空后结算 ready', async () => {
    repository.listPendingChunks
      .mockResolvedValueOnce([createChunk(0), createChunk(1)])
      .mockResolvedValueOnce([]);

    await run();

    expect(gateway.embed).toHaveBeenCalledWith(
      expect.objectContaining({
        taskAlias: 'retrieval.embed',
        modelAlias: 'embedding',
        purpose: 'passage',
        /* heading 参与向量文本，避免同一段正文在不同章节下向量几乎相同。 */
        inputs: ['第一节\n切块内容 0', '切块内容 1'],
      }),
    );
    expect(repository.writeEmbeddings).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: DOCUMENT_ID,
        identity: IDENTITY,
        chunkingVersion: 'parser-v1',
        embeddings: [
          expect.objectContaining({ chunkId: 'chunk-0' }),
          expect.objectContaining({ chunkId: 'chunk-1' }),
        ],
      }),
    );
    expect(repository.settleRun).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: { status: 'ready' } }),
    );
  });

  it('终态运行重投不调用 Provider，也不重复写入', async () => {
    repository.beginRun.mockResolvedValue(null);

    await run();

    expect(gateway.embed).not.toHaveBeenCalled();
    expect(repository.writeEmbeddings).not.toHaveBeenCalled();
    expect(repository.settleRun).not.toHaveBeenCalled();
  });

  it('未配置向量能力时写终态失败，不静默成功', async () => {
    await run({ gateway: null });

    expect(repository.createOrGetRun).toHaveBeenCalledWith({
      documentId: DOCUMENT_ID,
      identity: IDENTITY,
    });
    expect(repository.settleRun).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: { status: 'failed', failureCode: 'embedding_not_configured' },
      }),
    );
    expect(repository.beginRun).not.toHaveBeenCalled();
  });

  it('先建立运行账本再领取，生产入队不依赖额外登记步骤', async () => {
    repository.listPendingChunks.mockResolvedValue([]);

    await run();

    expect(repository.createOrGetRun.mock.invocationCallOrder[0]).toBeLessThan(
      repository.beginRun.mock.invocationCallOrder[0]!,
    );
  });

  it('批次未做完时抛出以换取重投，已完成进度不回退', async () => {
    repository.listPendingChunks.mockResolvedValue([
      createChunk(0),
      createChunk(1),
    ]);

    await expect(run()).rejects.toThrow('embedding_batches_remaining');
    expect(repository.writeEmbeddings).toHaveBeenCalledTimes(8);
    expect(repository.settleRun).not.toHaveBeenCalled();
  });

  it('最后一次仍有批次未完成时写失败终态，不把账本留在running', async () => {
    repository.listPendingChunks.mockResolvedValue([
      createChunk(0),
      createChunk(1),
    ]);

    await run({}, 3, 3);

    expect(repository.settleRun).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: {
          status: 'failed',
          failureCode: 'embedding_attempts_exhausted',
        },
      }),
    );
  });

  it('确定性 Provider 错误写终态失败，不再重试', async () => {
    repository.listPendingChunks.mockResolvedValue([createChunk(0)]);
    gateway.embed.mockRejectedValue(
      new ModelGatewayInvocationError({
        code: 'content_filtered',
        retryable: false,
      }),
    );

    await run();

    expect(repository.settleRun).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: {
          status: 'failed',
          failureCode: 'embedding_content_filtered',
        },
      }),
    );
  });

  it('可重试错误交给队列，重试耗尽后才写终态', async () => {
    repository.listPendingChunks.mockResolvedValue([createChunk(0)]);
    gateway.embed.mockRejectedValue(
      new ModelGatewayInvocationError({ code: 'rate_limit', retryable: true }),
    );

    await expect(run({}, 1, 3)).rejects.toMatchObject({
      normalized: { code: 'rate_limit' },
    });
    expect(repository.settleRun).not.toHaveBeenCalled();

    await run({}, 3, 3);
    expect(repository.settleRun).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: {
          status: 'failed',
          failureCode: 'embedding_attempts_exhausted',
        },
      }),
    );
  });

  it('返回向量数量与请求不符按非法响应终结', async () => {
    repository.listPendingChunks.mockResolvedValue([
      createChunk(0),
      createChunk(1),
    ]);
    gateway.embed.mockResolvedValue({
      embeddings: [vectorOf(0.1)],
      descriptor: {},
      metadata: {},
    } as never);

    await run();

    expect(repository.settleRun).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: {
          status: 'failed',
          failureCode: 'embedding_invalid_response',
        },
      }),
    );
    expect(repository.writeEmbeddings).not.toHaveBeenCalled();
  });
});
