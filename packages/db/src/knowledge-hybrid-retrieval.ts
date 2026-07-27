import { PLATFORM_EMBEDDING_DIMENSIONS } from '@educanvas/agent-core';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { getDb } from './client';
import {
  assertOwnedTurn,
  loadCandidates,
  type RetrievalCandidateEvidence,
} from './knowledge-retrieval-repository';
import { hashKnowledgeText } from './knowledge-source-repository';
import {
  knowledgeChunkEmbeddings,
  knowledgeChunks,
  retrievalCandidates,
  turnSourceVersions,
} from './schema';

type Database = ReturnType<typeof getDb>;
type DatabaseTransaction = Parameters<
  Parameters<Database['transaction']>[0]
>[0];

/** 词法检索使用的稳定 retriever 名；混合回退时仍诚实标记为纯 FTS。 */
export const LEXICAL_RETRIEVER = 'postgres_fts' as const;
/** 两路融合成功时的 retriever 名。 */
export const HYBRID_RETRIEVER = 'postgres_hybrid' as const;
/** 融合算法版本；算法或参数变化必须换版本，否则历史候选无法解释。 */
export const HYBRID_RETRIEVER_VERSION = 'rrf-v1' as const;
/**
 * 混合入口降级为纯词法时使用的版本名。
 *
 * 不复用 `retrieveFts` 的 `simple-v1`：同一 (retriever, version) 必须只对应一种
 * 排序语义，否则事后无法判断某条候选到底由哪条代码路径产生。
 */
export const HYBRID_LEXICAL_FALLBACK_VERSION = 'rrf-fallback-v1' as const;

/**
 * RRF 平滑常数。60 是 Cormack 等人给出的经验值，作用是让两路各自的头部结果都
 * 有机会进入融合结果，而不是让某一路的高分直接淹没另一路。它属于排序语义，
 * 变更必须同时提升 `HYBRID_RETRIEVER_VERSION`。
 */
const RRF_K = 60;

/** 单路召回上限相对最终 limit 的放大倍数，硬上限 200。 */
const POOL_MULTIPLIER = 4;
const MAX_POOL_SIZE = 200;

/**
 * 向量子查询的语句预算。超时不是错误而是降级信号：教学对话宁可用纯 FTS 立刻
 * 回答，也不能为等一次 ANN 扫描把整轮 Turn 拖过用户可接受的时延。
 */
const VECTOR_STATEMENT_TIMEOUT_MS = 1_500;

/** 向量身份。检索侧必须与写入侧完全一致，跨模型/版本/指令的向量不可比较。 */
export interface EmbeddingIdentity {
  embeddingModel: string;
  embeddingModelVersion: string;
  /** 语料侧指令，例如 `passage:v1`。 */
  instruction: string;
}

export interface HybridRetrievalResult {
  replayed: boolean;
  queryHash: string;
  /** 本次实际生效的检索器；降级时诚实返回词法检索器。 */
  retriever: typeof HYBRID_RETRIEVER | typeof LEXICAL_RETRIEVER;
  retrieverVersion: string;
  /** 向量路是否真的参与了本次融合，供调用方与诊断区分「无向量」与「向量无命中」。 */
  vectorApplied: boolean;
  candidates: readonly RetrievalCandidateEvidence[];
}

interface RankedChunk {
  turnSourceVersionId: string;
  chunkId: string;
  documentId: string;
  chunkIndex: number;
}

const boundedPool = (limit: number): number =>
  Math.min(limit * POOL_MULTIPLIER, MAX_POOL_SIZE);

/**
 * 归一化 RRF 分数到 [0,1]。
 *
 * `retrieval_candidates.score` 有 0..1 的库级约束，而 RRF 原始分是若干 1/(k+rank)
 * 之和。按「两路都排第一」的理论最大值缩放，保证既满足约束又保持同一次检索内
 * 分数的相对可比性。
 */
const normalizeRrf = (raw: number): number => {
  const maximum = 2 / (RRF_K + 1);
  return Math.min(1, Math.max(0, raw / maximum));
};

/** 词法召回。排序在分数之后再按 chunkIndex、chunkId 收敛，保证同分确定性。 */
async function lexicalRanking(
  transaction: DatabaseTransaction,
  input: { sessionId: string; turnId: string; query: string; poolSize: number },
): Promise<readonly RankedChunk[]> {
  const searchQuery = sql`websearch_to_tsquery('simple', ${input.query})`;
  const score = sql<number>`ts_rank_cd(${knowledgeChunks.searchVector}, ${searchQuery}, 32)`;
  return transaction
    .select({
      turnSourceVersionId: turnSourceVersions.id,
      chunkId: knowledgeChunks.id,
      documentId: turnSourceVersions.documentId,
      chunkIndex: knowledgeChunks.chunkIndex,
    })
    .from(turnSourceVersions)
    .innerJoin(
      knowledgeChunks,
      eq(knowledgeChunks.documentId, turnSourceVersions.documentId),
    )
    .where(
      and(
        eq(turnSourceVersions.sessionId, input.sessionId),
        eq(turnSourceVersions.turnId, input.turnId),
        sql`${knowledgeChunks.searchVector} @@ ${searchQuery}`,
      ),
    )
    .orderBy(
      desc(score),
      asc(knowledgeChunks.chunkIndex),
      asc(knowledgeChunks.id),
    )
    .limit(input.poolSize);
}

/**
 * 向量召回。
 *
 * 三条硬约束：
 * 1. 从 `turn_source_versions` 出发 join，召回范围天然被本轮冻结的文档限死，
 *    不存在「先全库 ANN、再按权限过滤」的窗口；
 * 2. 只接受与请求身份完全一致的向量，跨模型/版本/指令的向量不参与排序；
 * 3. 只接受 `chunk_content_hash` 与 chunk 当前哈希相等的向量——内容已经变化的
 *    陈旧向量必须落选，而不是以旧语义参与打分。
 */
async function vectorRanking(
  transaction: DatabaseTransaction,
  input: {
    sessionId: string;
    turnId: string;
    queryEmbedding: readonly number[];
    identity: EmbeddingIdentity;
    poolSize: number;
  },
): Promise<readonly RankedChunk[]> {
  const literal = sql.raw(`'[${input.queryEmbedding.join(',')}]'::vector`);
  const distance = sql<number>`${knowledgeChunkEmbeddings.embedding} <=> ${literal}`;
  return transaction
    .select({
      turnSourceVersionId: turnSourceVersions.id,
      chunkId: knowledgeChunks.id,
      documentId: turnSourceVersions.documentId,
      chunkIndex: knowledgeChunks.chunkIndex,
    })
    .from(turnSourceVersions)
    .innerJoin(
      knowledgeChunks,
      eq(knowledgeChunks.documentId, turnSourceVersions.documentId),
    )
    .innerJoin(
      knowledgeChunkEmbeddings,
      and(
        eq(knowledgeChunkEmbeddings.chunkId, knowledgeChunks.id),
        eq(knowledgeChunkEmbeddings.documentId, knowledgeChunks.documentId),
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
        eq(turnSourceVersions.sessionId, input.sessionId),
        eq(turnSourceVersions.turnId, input.turnId),
      ),
    )
    .orderBy(
      asc(distance),
      asc(knowledgeChunks.chunkIndex),
      asc(knowledgeChunks.id),
    )
    .limit(input.poolSize);
}

/**
 * Reciprocal Rank Fusion。
 *
 * 只用名次而不用原始分：`ts_rank_cd` 与余弦距离没有可比的量纲，任何把两者线性
 * 加权的做法都需要一个无法从数据推导的魔法系数。名次融合放弃了一部分区分度，
 * 换来一个可解释、不依赖分数标定的排序。
 *
 * 同分时依次按 chunkIndex、chunkId 收敛，保证同一输入永远得到同一顺序。
 */
function fuse(
  lexical: readonly RankedChunk[],
  vector: readonly RankedChunk[],
  limit: number,
): readonly (RankedChunk & { score: number })[] {
  const fused = new Map<string, RankedChunk & { raw: number }>();
  for (const ranking of [lexical, vector]) {
    ranking.forEach((chunk, index) => {
      const existing = fused.get(chunk.chunkId);
      const contribution = 1 / (RRF_K + index + 1);
      if (existing) existing.raw += contribution;
      else fused.set(chunk.chunkId, { ...chunk, raw: contribution });
    });
  }
  return [...fused.values()]
    .sort(
      (left, right) =>
        right.raw - left.raw ||
        left.chunkIndex - right.chunkIndex ||
        (left.chunkId < right.chunkId ? -1 : 1),
    )
    .slice(0, limit)
    .map(({ raw, ...chunk }) => ({ ...chunk, score: normalizeRrf(raw) }));
}

/**
 * 词法 + 向量的混合检索（ADR-0015）。
 *
 * 与 `retrieveFts` 并存而不是取代它：纯词法入口仍是最小依赖的可用路径，本入口
 * 在其之上增加语义召回。任一环节缺失——未配置向量模型、查询向量为空、向量库
 * 尚未回填、ANN 超时——都退回纯词法并诚实标记 retriever，绝不返回空结果冒充
 * 「没有相关内容」。
 *
 * 候选与 `retrieveFts` 写入同一张 `retrieval_candidates`，因此引用白名单、
 * 引用持久化和证据读取路径完全不变。
 */
export class DrizzleKnowledgeHybridRetrieval {
  constructor(private readonly providedDatabase?: Database) {}

  private get database(): Database {
    return this.providedDatabase ?? getDb();
  }

  async retrieveHybrid(input: {
    trustedStudentId: string;
    sessionId: string;
    turnId: string;
    query: string;
    limit: number;
    traceId: string;
    /** 已由服务端生成的查询向量；null 表示本次只能走词法路径。 */
    queryEmbedding?: readonly number[] | null;
    /** 语料侧向量身份；缺失时同样只走词法路径。 */
    embeddingIdentity?: EmbeddingIdentity | null;
    now?: Date;
  }): Promise<HybridRetrievalResult> {
    const query = input.query.trim().replace(/\s+/g, ' ');
    if (query.length < 1 || query.length > 4_096) {
      throw new TypeError('混合检索查询长度必须为1-4096');
    }
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 50) {
      throw new TypeError('混合检索limit必须为1-50的整数');
    }
    /* 维度不符一律拒绝而不是截断：截断出的向量语义无法解释，比没有向量更糟。 */
    const queryEmbedding =
      input.queryEmbedding &&
      input.queryEmbedding.length === PLATFORM_EMBEDDING_DIMENSIONS &&
      input.queryEmbedding.every((component) => Number.isFinite(component))
        ? input.queryEmbedding
        : null;
    const identity = input.embeddingIdentity ?? null;
    const vectorRequested = queryEmbedding !== null && identity !== null;

    const queryHash = hashKnowledgeText(query);
    const retrieverVersion = vectorRequested
      ? HYBRID_RETRIEVER_VERSION
      : HYBRID_LEXICAL_FALLBACK_VERSION;
    const lockKey = `turn-hybrid-retrieval-v1:${input.turnId}:${queryHash}:${retrieverVersion}`;

    return this.database.transaction(async (transaction) => {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`,
      );
      await assertOwnedTurn(transaction, input);

      const poolSize = boundedPool(input.limit);
      const lexical = await lexicalRanking(transaction, {
        sessionId: input.sessionId,
        turnId: input.turnId,
        query,
        poolSize,
      });

      let vector: readonly RankedChunk[] = [];
      let vectorApplied = false;
      if (vectorRequested && queryEmbedding && identity) {
        try {
          /* PostgreSQL 的 statement_timeout 会中止当前事务。Drizzle 的嵌套事务
             在 PostgreSQL 上使用 savepoint，并由驱动负责 rollback；超时因此只
             回滚向量子查询，外层仍能写入 FTS 候选。 */
          vector = await transaction.transaction(async (vectorTransaction) => {
            await vectorTransaction.execute(
              sql`set local statement_timeout = ${sql.raw(String(VECTOR_STATEMENT_TIMEOUT_MS))}`,
            );
            const ranked = await vectorRanking(vectorTransaction, {
              sessionId: input.sessionId,
              turnId: input.turnId,
              queryEmbedding,
              identity,
              poolSize,
            });
            await vectorTransaction.execute(
              sql`set local statement_timeout = 0`,
            );
            return ranked;
          });
          vectorApplied = true;
        } catch {
          /* 超时或扩展缺失：降级为纯词法。异常细节不进入返回值与账本。 */
          vector = [];
          vectorApplied = false;
        }
      }

      const retriever = vectorApplied ? HYBRID_RETRIEVER : LEXICAL_RETRIEVER;
      const effectiveVersion = vectorApplied
        ? HYBRID_RETRIEVER_VERSION
        : HYBRID_LEXICAL_FALLBACK_VERSION;

      const existing = await loadCandidates(transaction, {
        sessionId: input.sessionId,
        turnId: input.turnId,
        queryHash,
        retriever,
        retrieverVersion: effectiveVersion,
      });
      if (existing.length > 0) {
        return {
          replayed: true,
          queryHash,
          retriever,
          retrieverVersion: effectiveVersion,
          vectorApplied,
          candidates: existing,
        };
      }

      const fused = fuse(lexical, vector, input.limit);
      if (fused.length === 0) {
        return {
          replayed: false,
          queryHash,
          retriever,
          retrieverVersion: effectiveVersion,
          vectorApplied,
          candidates: [],
        };
      }

      await transaction.insert(retrievalCandidates).values(
        fused.map((chunk, index) => ({
          sessionId: input.sessionId,
          turnId: input.turnId,
          turnSourceVersionId: chunk.turnSourceVersionId,
          chunkId: chunk.chunkId,
          documentId: chunk.documentId,
          retriever,
          retrieverVersion: effectiveVersion,
          rank: index + 1,
          score: chunk.score,
          queryHash,
          traceId: input.traceId,
          createdAt: input.now,
        })),
      );
      return {
        replayed: false,
        queryHash,
        retriever,
        retrieverVersion: effectiveVersion,
        vectorApplied,
        candidates: await loadCandidates(transaction, {
          sessionId: input.sessionId,
          turnId: input.turnId,
          queryHash,
          retriever,
          retrieverVersion: effectiveVersion,
        }),
      };
    });
  }
}
