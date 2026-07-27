/**
 * 教学领域端口 — teaching-core 对外依赖的接口定义。
 *
 * ## 端口-适配器模式
 *
 * teaching-core 是纯领域层，不依赖 Drizzle/Next.js/PGVector 等基础设施。
 * 它只定义接口（Port），由外部适配器（db/teaching-adapters 等）实现。
 * 这保证领域逻辑可独立测试、独立演进。
 *
 * ## Transaction 边界
 *
 * `TeachingTransaction` 把 Session/Mastery/Event 三个 Repository 绑在一起，
 * `TeachingUnitOfWork.run()` 保证三者在同一数据库事务内原子更新。
 * 这至关重要 — 状态转移和对应领域事件必须同时落盘或同时回滚。
 */

import type { DomainLearningEvent } from './domain-events';
import type { MisconceptionTag } from './mastery';
import type { TeachingState } from './state-machine';

export type {
  ModelGateway,
  StructuredModelGateway,
  StructuredModelRequest,
  StructuredModelResult,
  TurnModelGateway,
} from '@educanvas/agent-core';

/** 教学核心读取的最小会话投影，不暴露Drizzle行对象。 */
export interface LessonSessionSnapshot {
  id: string;
  studentId: string;
  knowledgeNodeId: string | null;
  state: TeachingState;
  interruptedState: TeachingState | null;
  version: number;
}

/** 乐观锁状态更新命令；适配器必须保证expectedVersion不匹配时拒绝写入。 */
export interface UpdateSessionStateInput {
  sessionId: string;
  expectedVersion: number;
  state: TeachingState;
  interruptedState: TeachingState | null;
}

/** 会话持久化Port，由Drizzle或未来core-api适配器实现。 */
export interface SessionRepository {
  getById(sessionId: string): Promise<LessonSessionSnapshot | null>;
  updateState(input: UpdateSessionStateInput): Promise<LessonSessionSnapshot>;
}

/** 教学核心读取和更新的掌握度投影。 */
export interface MasterySnapshot {
  studentId: string;
  knowledgeNodeId: string;
  masteryScore: number;
  attemptCount: number;
  correctCount: number;
  hintCount: number;
  activeMisconceptions: readonly MisconceptionTag[];
  lastPracticedAt: string | null;
  nextReviewAt: string | null;
  version: number;
}

/** 乐观锁掌握度写入命令，计算结果必须先由teaching-core产生。 */
export interface SaveMasteryInput {
  snapshot: MasterySnapshot;
  expectedVersion: number;
}

/** 掌握度持久化Port，不允许模型或页面绕过领域函数直接写分数。 */
export interface MasteryRepository {
  get(
    studentId: string,
    knowledgeNodeId: string,
  ): Promise<MasterySnapshot | null>;
  save(input: SaveMasteryInput): Promise<MasterySnapshot>;
}

/** 可信事件存储Port；append必须在幂等键冲突时返回原事件或明确拒绝。 */
export interface EventStore {
  /** 在当前事务内串行化同一幂等键；业务写入必须先加锁再检查已有事实。 */
  lockIdempotencyKey(idempotencyKey: string): Promise<void>;
  getByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<DomainLearningEvent | null>;
  /**
   * 在当前Unit of Work内原子分配会话级单调序号；事务回滚也必须撤销分配。
   * 事件序号独立于会话状态version，禁止使用“查询最大值+1”。
   */
  allocateSequence(sessionId: string): Promise<number>;
  append(event: DomainLearningEvent): Promise<DomainLearningEvent>;
  listBySession(sessionId: string): Promise<readonly DomainLearningEvent[]>;
}

/** 同一数据库事务内可用的领域仓储集合，保证事实事件与当前投影原子更新。 */
export interface TeachingTransaction {
  sessions: SessionRepository;
  mastery: MasteryRepository;
  events: EventStore;
}

/**
 * 教学事务Port；状态或掌握度投影更新必须与对应领域事件在同一operation内提交或回滚。
 */
export interface TeachingUnitOfWork {
  run<Result>(
    operation: (transaction: TeachingTransaction) => Promise<Result>,
  ): Promise<Result>;
}

/** 与pgvector和具体Reranker无关的检索请求。 */
export interface KnowledgeRetrievalRequest {
  query: string;
  gradeBand: string;
  courseSlug: string;
  knowledgeNodeId: string | null;
  limit: number;
  traceId: string;
}

/** 可追溯到教材位置的单条检索证据。 */
export interface KnowledgeEvidence {
  sourceId: string;
  chunkId: string;
  text: string;
  page: number | null;
  confidence: number;
  embeddingSpaceVersion: string;
}

/** 检索Port统一返回证据包，教学核心不感知全文、向量或重排实现。 */
export interface KnowledgeRetriever {
  retrieve(
    request: KnowledgeRetrievalRequest,
  ): Promise<readonly KnowledgeEvidence[]>;
}
