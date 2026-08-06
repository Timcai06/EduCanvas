import {
  ModelGatewayInvocationError,
  type EmbeddingModelGateway,
} from '@educanvas/agent-core';
import {
  DrizzleKnowledgeEmbeddingRepository,
  KnowledgeEmbeddingRunNotFoundError,
  type EmbeddingIdentity,
  type PendingEmbeddingChunk,
} from '@educanvas/db';
import type { Task } from 'graphile-worker';
import { z } from 'zod';
import {
  createWorkerModelRuntime,
  readModelGatewayEnvironment,
  type WorkerModelRuntime,
} from '../model-runtime.js';

/** 队列任务名；`域:动作` 与其余 Graphile 任务保持一致。 */
export const KNOWLEDGE_EMBED_DOCUMENT_TASK =
  'knowledge:embed_document' as const;

const payloadSchema = z
  .object({
    documentId: z.uuid(),
    /** 切块版本取自文档解析器版本，由入队方冻结，Worker 不自行推断。 */
    chunkingVersion: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/),
  })
  .strict();

/**
 * 单次任务处理的批次上限。
 *
 * 一个文档可能有上万个切块；一次任务全量嵌入会长时间占用连接并让任何中途失败
 * 都退回起点。分批 + 队列重投让进度单调向前，账本里的 `embedded_chunk_count`
 * 因此始终是可信的真实进度。
 */
const MAX_BATCHES_PER_ATTEMPT = 8;

/** 稳定失败码；写入运行账本供运维查询，只能追加不能改写含义。 */
const FAILURE_CODES = {
  notConfigured: 'embedding_not_configured',
  invalidResponse: 'embedding_invalid_response',
  contentFiltered: 'embedding_content_filtered',
  exhausted: 'embedding_attempts_exhausted',
} as const;

interface EmbeddingRepositoryPort {
  createOrGetRun(input: {
    documentId: string;
    identity: EmbeddingIdentity;
  }): Promise<unknown>;
  beginRun(input: {
    documentId: string;
    identity: EmbeddingIdentity;
  }): Promise<{ totalChunkCount: number } | null>;
  listPendingChunks(input: {
    documentId: string;
    identity: EmbeddingIdentity;
    limit: number;
  }): Promise<readonly PendingEmbeddingChunk[]>;
  writeEmbeddings(input: {
    documentId: string;
    identity: EmbeddingIdentity;
    chunkingVersion: string;
    embeddings: readonly {
      chunkId: string;
      chunkContentHash: string;
      vector: readonly number[];
    }[];
  }): Promise<unknown>;
  settleRun(input: {
    documentId: string;
    identity: EmbeddingIdentity;
    outcome: { status: 'ready' } | { status: 'failed'; failureCode: string };
  }): Promise<unknown>;
}

/**
 * 切块向量化的输入投影。
 *
 * heading 参与向量文本是有意的：教材切块经常以「本节讲什么」开头，缺了它同一段
 * 正文在不同章节下会得到几乎相同的向量。分隔用换行而不是特殊标记，避免把某个
 * 供应商的模板语法固化进平台数据。
 */
function embeddingInput(chunk: PendingEmbeddingChunk): string {
  return chunk.heading ? `${chunk.heading}\n${chunk.content}` : chunk.content;
}

/**
 * 教材文档向量化任务（ADR-0015）。
 *
 * 失败语义与既有派生任务一致：
 * - 归一化的确定性错误（非法响应、内容过滤）直接写终态失败，不再重试；
 * - 可重试错误（限流、超时、不可用）向 Graphile 抛出，由队列退避重投；
 * - 重试耗尽时把运行结算为 failed，避免账本永远停在 running。
 *
 * 任何失败都不影响既有 FTS：向量缺失只会让混合检索退回纯词法。
 */
export function createEmbedKnowledgeDocumentTask(dependencies?: {
  repository?: EmbeddingRepositoryPort;
  gateway?: EmbeddingModelGateway | null;
  identity?: EmbeddingIdentity | null;
  batchSize?: number;
}): Task {
  return async (rawPayload, helpers) => {
    const payload = payloadSchema.parse(rawPayload);
    const repository =
      dependencies?.repository ??
      (new DrizzleKnowledgeEmbeddingRepository() as unknown as EmbeddingRepositoryPort);
    // R03：embedding gateway 与 identity 共享同一已验证配置（惰性一次解析）。
    let workerRuntime: WorkerModelRuntime | null = null;
    const getRuntime = (): WorkerModelRuntime => {
      if (workerRuntime === null) {
        workerRuntime = createWorkerModelRuntime(readModelGatewayEnvironment());
      }
      return workerRuntime;
    };
    const identity =
      dependencies?.identity === undefined
        ? getRuntime().embeddingIdentity
        : dependencies.identity;
    const gateway =
      dependencies?.gateway === undefined
        ? getRuntime().embedding
        : dependencies.gateway;

    if (!identity) {
      helpers.logger.warn(
        `文档 ${payload.documentId} 未配置向量身份，跳过向量化`,
      );
      return;
    }

    /* 运行账本必须在领取前存在。把登记内聚在 Worker 里，避免所有入队方都必须
       记住额外一步，也让历史回填任务可以只投递同一种 payload。 */
    await repository.createOrGetRun({
      documentId: payload.documentId,
      identity,
    });

    if (!gateway) {
      /* 未配置向量能力：登记终态失败而不是静默成功，让运维能查到原因。 */
      await settleQuietly(repository, {
        documentId: payload.documentId,
        identity,
        failureCode: FAILURE_CODES.notConfigured,
      });
      helpers.logger.warn(
        `文档 ${payload.documentId} 未配置向量能力，跳过向量化`,
      );
      return;
    }

    const run = await repository.beginRun({
      documentId: payload.documentId,
      identity,
    });
    if (!run) {
      helpers.logger.info(
        `文档 ${payload.documentId} 向量化已终结，跳过重复执行`,
      );
      return;
    }

    const batchSize = Math.min(Math.max(1, dependencies?.batchSize ?? 64), 256);
    const attempts = helpers.job?.attempts ?? 1;
    const maxAttempts = helpers.job?.max_attempts ?? 1;

    try {
      for (let batch = 0; batch < MAX_BATCHES_PER_ATTEMPT; batch += 1) {
        const pending = await repository.listPendingChunks({
          documentId: payload.documentId,
          identity,
          limit: batchSize,
        });
        if (pending.length === 0) {
          await repository.settleRun({
            documentId: payload.documentId,
            identity,
            outcome: { status: 'ready' },
          });
          helpers.logger.info(`文档 ${payload.documentId} 向量化完成`);
          return;
        }

        const result = await gateway.embed({
          taskAlias: 'retrieval.embed',
          modelAlias: 'embedding',
          purpose: 'passage',
          inputs: pending.map(embeddingInput),
          promptVersion: 'knowledge-passage-embedding-v1',
          traceId: `knowledge-embedding:${payload.documentId}`,
          operationId: payload.documentId,
        });
        if (result.embeddings.length !== pending.length) {
          throw new EmbeddingTerminalFailure(FAILURE_CODES.invalidResponse);
        }

        await repository.writeEmbeddings({
          documentId: payload.documentId,
          identity,
          chunkingVersion: payload.chunkingVersion,
          embeddings: pending.map((chunk, index) => ({
            chunkId: chunk.chunkId,
            chunkContentHash: chunk.contentHash,
            vector: result.embeddings[index]!,
          })),
        });
      }
      /* 本次尝试已达批次上限但仍有剩余：重投继续，进度已经落库不会回退。 */
      helpers.logger.info(
        `文档 ${payload.documentId} 向量化未完成，等待下一次重投`,
      );
      throw new EmbeddingContinuationRequired();
    } catch (error) {
      if (error instanceof EmbeddingContinuationRequired) {
        if (attempts < maxAttempts) throw error;
        await repository.settleRun({
          documentId: payload.documentId,
          identity,
          outcome: { status: 'failed', failureCode: FAILURE_CODES.exhausted },
        });
        helpers.logger.error(`文档 ${payload.documentId} 向量化批次重试耗尽`);
        return;
      }
      const terminal = terminalFailureCode(error);
      if (terminal) {
        await repository.settleRun({
          documentId: payload.documentId,
          identity,
          outcome: { status: 'failed', failureCode: terminal },
        });
        helpers.logger.error(
          `文档 ${payload.documentId} 向量化终态失败: ${terminal}`,
        );
        return;
      }
      if (attempts >= maxAttempts) {
        await repository.settleRun({
          documentId: payload.documentId,
          identity,
          outcome: { status: 'failed', failureCode: FAILURE_CODES.exhausted },
        });
        helpers.logger.error(`文档 ${payload.documentId} 向量化重试耗尽`);
        return;
      }
      throw error;
    }
  };
}

/** 让 Graphile 重投以继续下一批；它不是错误，只是「还没做完」。 */
class EmbeddingContinuationRequired extends Error {
  override readonly name = 'EmbeddingContinuationRequired';

  constructor() {
    super('embedding_batches_remaining');
  }
}

/** 确定性失败：重试不会改变结果，直接写终态。 */
class EmbeddingTerminalFailure extends Error {
  override readonly name = 'EmbeddingTerminalFailure';

  constructor(readonly code: string) {
    super(code);
  }
}

function terminalFailureCode(error: unknown): string | null {
  if (error instanceof EmbeddingTerminalFailure) return error.code;
  if (error instanceof ModelGatewayInvocationError) {
    if (error.normalized.retryable) return null;
    return error.normalized.code === 'content_filtered'
      ? FAILURE_CODES.contentFiltered
      : FAILURE_CODES.invalidResponse;
  }
  return null;
}

/** 未配置向量能力时账本可能根本不存在；结算失败不应掩盖真正的原因。 */
async function settleQuietly(
  repository: EmbeddingRepositoryPort,
  input: {
    documentId: string;
    identity: EmbeddingIdentity | null;
    failureCode: string;
  },
): Promise<void> {
  if (!input.identity) return;
  try {
    await repository.settleRun({
      documentId: input.documentId,
      identity: input.identity,
      outcome: { status: 'failed', failureCode: input.failureCode },
    });
  } catch (error) {
    if (!(error instanceof KnowledgeEmbeddingRunNotFoundError)) throw error;
  }
}

export const embedKnowledgeDocument = createEmbedKnowledgeDocumentTask();
