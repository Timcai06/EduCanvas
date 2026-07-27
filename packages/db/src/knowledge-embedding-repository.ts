import { PLATFORM_EMBEDDING_DIMENSIONS } from '@educanvas/agent-core';
import { and, asc, count, eq, isNull, sql } from 'drizzle-orm';
import { getDb } from './client';
import type { EmbeddingIdentity } from './knowledge-hybrid-retrieval';
import {
  knowledgeChunkEmbeddings,
  knowledgeChunks,
  knowledgeDocuments,
  knowledgeEmbeddingRuns,
} from './schema';

type Database = ReturnType<typeof getDb>;

/** 单批写入上限；与模型网关的批量上限对齐，约束单事务持锁规模。 */
export const MAX_EMBEDDING_WRITE_BATCH = 256;

export type KnowledgeEmbeddingRunStatus =
  'queued' | 'running' | 'ready' | 'failed';

export class KnowledgeEmbeddingRunNotFoundError extends Error {
  readonly code = 'knowledge_embedding_run_not_found';

  constructor() {
    super('向量化运行不存在');
    this.name = 'KnowledgeEmbeddingRunNotFoundError';
  }
}

/** 待向量化的 chunk。正文只在进程内停留到写入向量为止，不进入任何账本。 */
export interface PendingEmbeddingChunk {
  chunkId: string;
  documentId: string;
  chunkIndex: number;
  contentHash: string;
  content: string;
  heading: string | null;
}

export interface KnowledgeEmbeddingRunSnapshot {
  id: string;
  documentId: string;
  status: KnowledgeEmbeddingRunStatus;
  embeddedChunkCount: number;
  totalChunkCount: number;
  failureCode: string | null;
}

const SAFE_FAILURE_CODE = /^[a-z][a-z0-9_]{0,127}$/;

function toRunSnapshot(
  row: typeof knowledgeEmbeddingRuns.$inferSelect,
): KnowledgeEmbeddingRunSnapshot {
  return {
    id: row.id,
    documentId: row.documentId,
    status: row.status as KnowledgeEmbeddingRunStatus,
    embeddedChunkCount: row.embeddedChunkCount,
    totalChunkCount: row.totalChunkCount,
    failureCode: row.failureCode,
  };
}

/**
 * 切块向量的唯一写入边界（ADR-0015）。
 *
 * 三条纪律：
 * - 向量是派生物：本仓储只写 `knowledge_chunk_embeddings` 与运行账本，绝不修改
 *   `knowledge_chunks`、`knowledge_documents` 或任何检索候选；
 * - 幂等以向量身份为键：同一 (chunk, 模型, 版本, 指令) 重复写入收敛为一行，
 *   重试和重投不会产生第二个向量；
 * - 内容漂移显式表达：写入时冻结 `chunkContentHash`，内容变化后的旧向量会被
 *   检索排除，而不是以旧语义继续参与打分。
 */
export class DrizzleKnowledgeEmbeddingRepository {
  constructor(private readonly providedDatabase?: Database) {}

  private get database(): Database {
    return this.providedDatabase ?? getDb();
  }

  /**
   * 为某个已就绪文档登记一次向量化运行；同一身份重复登记返回既有运行。
   * 只有 `ready` 文档可以登记：解析失败或已被取代的版本不该消耗向量预算。
   */
  async createOrGetRun(input: {
    documentId: string;
    identity: EmbeddingIdentity;
  }): Promise<{ replayed: boolean; run: KnowledgeEmbeddingRunSnapshot }> {
    const lockKey = `knowledge-embedding-run-v1:${input.documentId}:${input.identity.embeddingModel}:${input.identity.embeddingModelVersion}:${input.identity.instruction}`;
    return this.database.transaction(async (transaction) => {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`,
      );
      const [existing] = await transaction
        .select()
        .from(knowledgeEmbeddingRuns)
        .where(this.identityFilter(input.documentId, input.identity))
        .limit(1);
      if (existing) {
        return { replayed: true, run: toRunSnapshot(existing) };
      }

      const [document] = await transaction
        .select({ parseStatus: knowledgeDocuments.parseStatus })
        .from(knowledgeDocuments)
        .where(eq(knowledgeDocuments.id, input.documentId))
        .limit(1);
      if (!document || document.parseStatus !== 'ready') {
        throw new KnowledgeEmbeddingRunNotFoundError();
      }
      const [totals] = await transaction
        .select({ total: count() })
        .from(knowledgeChunks)
        .where(eq(knowledgeChunks.documentId, input.documentId));

      const [created] = await transaction
        .insert(knowledgeEmbeddingRuns)
        .values({
          documentId: input.documentId,
          embeddingModel: input.identity.embeddingModel,
          embeddingModelVersion: input.identity.embeddingModelVersion,
          instruction: input.identity.instruction,
          totalChunkCount: totals?.total ?? 0,
        })
        .returning();
      if (!created) throw new Error('向量化运行登记失败');
      return { replayed: false, run: toRunSnapshot(created) };
    });
  }

  /**
   * 领取一次执行。只有 `queued` 与 `running` 可被领取：终态运行重投一律返回
   * null，让 Worker 幂等跳过而不是重复消耗供应商配额。
   */
  async beginRun(input: {
    documentId: string;
    identity: EmbeddingIdentity;
    now?: Date;
  }): Promise<KnowledgeEmbeddingRunSnapshot | null> {
    const now = input.now ?? new Date();
    const [row] = await this.database
      .update(knowledgeEmbeddingRuns)
      .set({ status: 'running', startedAt: now, updatedAt: now })
      .where(
        and(
          this.identityFilter(input.documentId, input.identity),
          sql`${knowledgeEmbeddingRuns.status} in ('queued', 'running')`,
        ),
      )
      .returning();
    return row ? toRunSnapshot(row) : null;
  }

  /**
   * 读取尚未拥有当前身份向量的 chunk。
   *
   * 用 left join + is null 而不是 `not exists` 子查询：两者语义相同，但这里的
   * 连接条件同时包含内容哈希，因此内容变化后的 chunk 会自动重新出现在待办里，
   * 不需要额外的失效扫描。
   */
  async listPendingChunks(input: {
    documentId: string;
    identity: EmbeddingIdentity;
    limit: number;
  }): Promise<readonly PendingEmbeddingChunk[]> {
    const limit = Math.min(
      Math.max(1, Math.trunc(input.limit)),
      MAX_EMBEDDING_WRITE_BATCH,
    );
    return this.database
      .select({
        chunkId: knowledgeChunks.id,
        documentId: knowledgeChunks.documentId,
        chunkIndex: knowledgeChunks.chunkIndex,
        contentHash: knowledgeChunks.contentHash,
        content: knowledgeChunks.content,
        heading: knowledgeChunks.heading,
      })
      .from(knowledgeChunks)
      .leftJoin(
        knowledgeChunkEmbeddings,
        and(
          eq(knowledgeChunkEmbeddings.chunkId, knowledgeChunks.id),
          eq(
            knowledgeChunkEmbeddings.chunkContentHash,
            knowledgeChunks.contentHash,
          ),
          eq(
            knowledgeChunkEmbeddings.embeddingModel,
            input.identity.embeddingModel,
          ),
          eq(
            knowledgeChunkEmbeddings.embeddingModelVersion,
            input.identity.embeddingModelVersion,
          ),
          eq(knowledgeChunkEmbeddings.instruction, input.identity.instruction),
        ),
      )
      .where(
        and(
          eq(knowledgeChunks.documentId, input.documentId),
          isNull(knowledgeChunkEmbeddings.id),
        ),
      )
      .orderBy(asc(knowledgeChunks.chunkIndex), asc(knowledgeChunks.id))
      .limit(limit);
  }

  /**
   * 写入一批向量并推进运行进度。
   *
   * 维度在这里再校验一次而不是只信任适配器：这是向量进入索引列前的最后一道
   * 关卡，写错维度会直接让插入失败在约束上，错误信息远不如显式拒绝可读。
   *
   * 冲突时更新向量而非忽略：同一身份下重新嵌入应当以最新结果为准，而 chunk
   * 内容变化会因为哈希不同而落到另一行，不会被这里覆盖。
   */
  async writeEmbeddings(input: {
    documentId: string;
    identity: EmbeddingIdentity;
    chunkingVersion: string;
    embeddings: readonly {
      chunkId: string;
      chunkContentHash: string;
      vector: readonly number[];
    }[];
    now?: Date;
  }): Promise<KnowledgeEmbeddingRunSnapshot> {
    if (
      input.embeddings.length === 0 ||
      input.embeddings.length > MAX_EMBEDDING_WRITE_BATCH
    ) {
      throw new TypeError(`向量批量必须为1-${MAX_EMBEDDING_WRITE_BATCH}`);
    }
    if (
      input.embeddings.some(
        (entry) =>
          entry.vector.length !== PLATFORM_EMBEDDING_DIMENSIONS ||
          entry.vector.some((component) => !Number.isFinite(component)),
      )
    ) {
      throw new TypeError('向量维度或分量非法');
    }

    const now = input.now ?? new Date();
    return this.database.transaction(async (transaction) => {
      await transaction
        .insert(knowledgeChunkEmbeddings)
        .values(
          input.embeddings.map((entry) => ({
            chunkId: entry.chunkId,
            documentId: input.documentId,
            embeddingModel: input.identity.embeddingModel,
            embeddingModelVersion: input.identity.embeddingModelVersion,
            dimensions: PLATFORM_EMBEDDING_DIMENSIONS,
            instruction: input.identity.instruction,
            chunkingVersion: input.chunkingVersion,
            chunkContentHash: entry.chunkContentHash,
            embedding: [...entry.vector],
            createdAt: now,
          })),
        )
        .onConflictDoUpdate({
          target: [
            knowledgeChunkEmbeddings.chunkId,
            knowledgeChunkEmbeddings.embeddingModel,
            knowledgeChunkEmbeddings.embeddingModelVersion,
            knowledgeChunkEmbeddings.instruction,
          ],
          set: {
            embedding: sql`excluded.embedding`,
            chunkContentHash: sql`excluded.chunk_content_hash`,
            chunkingVersion: sql`excluded.chunking_version`,
            createdAt: sql`excluded.created_at`,
          },
        });

      /* 进度按实际落库行数重算，而不是累加批大小：重投同一批时累加会让计数
         超过总数并撞上库级约束。 */
      const [embedded] = await transaction
        .select({ total: count() })
        .from(knowledgeChunkEmbeddings)
        .innerJoin(
          knowledgeChunks,
          and(
            eq(knowledgeChunks.id, knowledgeChunkEmbeddings.chunkId),
            eq(
              knowledgeChunks.contentHash,
              knowledgeChunkEmbeddings.chunkContentHash,
            ),
          ),
        )
        .where(
          and(
            eq(knowledgeChunkEmbeddings.documentId, input.documentId),
            eq(
              knowledgeChunkEmbeddings.embeddingModel,
              input.identity.embeddingModel,
            ),
            eq(
              knowledgeChunkEmbeddings.embeddingModelVersion,
              input.identity.embeddingModelVersion,
            ),
            eq(
              knowledgeChunkEmbeddings.instruction,
              input.identity.instruction,
            ),
          ),
        );
      const [row] = await transaction
        .update(knowledgeEmbeddingRuns)
        .set({ embeddedChunkCount: embedded?.total ?? 0, updatedAt: now })
        .where(this.identityFilter(input.documentId, input.identity))
        .returning();
      if (!row) throw new KnowledgeEmbeddingRunNotFoundError();
      return toRunSnapshot(row);
    });
  }

  /**
   * 结算运行终态。`failureCode` 只允许稳定小写码：它会被运维查询与告警消费，
   * 不能承载供应商消息、Prompt 或堆栈。
   */
  async settleRun(input: {
    documentId: string;
    identity: EmbeddingIdentity;
    outcome: { status: 'ready' } | { status: 'failed'; failureCode: string };
    now?: Date;
  }): Promise<KnowledgeEmbeddingRunSnapshot> {
    if (
      input.outcome.status === 'failed' &&
      !SAFE_FAILURE_CODE.test(input.outcome.failureCode)
    ) {
      throw new TypeError('failureCode必须为稳定小写码');
    }
    const now = input.now ?? new Date();
    const [row] = await this.database
      .update(knowledgeEmbeddingRuns)
      .set({
        status: input.outcome.status,
        failureCode:
          input.outcome.status === 'failed' ? input.outcome.failureCode : null,
        completedAt: now,
        updatedAt: now,
        /* running 是终态的唯一合法前驱，但崩溃恢复可能直接从 queued 结算； */
        startedAt: sql`coalesce(${knowledgeEmbeddingRuns.startedAt}, ${now})`,
      })
      .where(this.identityFilter(input.documentId, input.identity))
      .returning();
    if (!row) throw new KnowledgeEmbeddingRunNotFoundError();
    return toRunSnapshot(row);
  }

  private identityFilter(documentId: string, identity: EmbeddingIdentity) {
    return and(
      eq(knowledgeEmbeddingRuns.documentId, documentId),
      eq(knowledgeEmbeddingRuns.embeddingModel, identity.embeddingModel),
      eq(
        knowledgeEmbeddingRuns.embeddingModelVersion,
        identity.embeddingModelVersion,
      ),
      eq(knowledgeEmbeddingRuns.instruction, identity.instruction),
    );
  }
}
