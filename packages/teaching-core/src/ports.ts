import type { z } from 'zod';
import type { DomainLearningEvent } from './domain-events';
import type { MisconceptionTag } from './mastery';
import type { TeachingState } from './state-machine';

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

/** 与供应商无关的模型消息结构。 */
export interface ModelMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** 结构化模型调用请求；业务层只使用任务别名，不提供供应商模型ID。 */
export interface StructuredModelRequest<Output> {
  taskAlias: string;
  messages: readonly ModelMessage[];
  schema: z.ZodType<Output>;
  promptVersion: string;
  traceId: string;
}

/** 结构化模型调用结果及审计所需元数据。 */
export interface StructuredModelResult<Output> {
  output: Output;
  provider: string;
  modelRevision: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}

/** 模型网关Port；超时、Fallback、配额和供应商适配属于实现层。 */
export interface ModelGateway {
  generateStructured<Output>(
    request: StructuredModelRequest<Output>,
  ): Promise<StructuredModelResult<Output>>;
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
