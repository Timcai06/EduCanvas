import { and, asc, desc, eq, inArray, max, sql } from 'drizzle-orm';
import { getDb } from './client';
import {
  hashKnowledgeText,
  knowledgeSourceLockKey,
} from './knowledge-source-repository';
import {
  chatMessages,
  knowledgeChunks,
  knowledgeDocuments,
  knowledgeSources,
  lessonSessions,
  messageCitations,
  retrievalCandidates,
  sessionSourceBindings,
  turnSourceSnapshots,
  turnSourceVersions,
} from './schema';

type Database = ReturnType<typeof getDb>;
type DatabaseTransaction = Parameters<
  Parameters<Database['transaction']>[0]
>[0];

export interface SessionSourceBindingSnapshot {
  id: string;
  sessionId: string;
  sourceId: string;
  sequence: number;
  enabled: boolean;
  mutationId: string;
  createdAt: string;
}

export interface TurnSourceVersionSnapshot {
  id: string;
  sessionId: string;
  turnId: string;
  sourceId: string;
  documentId: string;
  documentVersion: number;
  contentHash: string;
  createdAt: string;
}

export interface RetrievalCandidateEvidence {
  candidateId: string;
  sessionId: string;
  turnId: string;
  sourceId: string;
  sourceTitle: string;
  documentId: string;
  documentVersion: number;
  documentContentHash: string;
  chunkId: string;
  chunkContentHash: string;
  text: string;
  heading: string | null;
  pageStart: number | null;
  pageEnd: number | null;
  retriever: string;
  retrieverVersion: string;
  rank: number;
  score: number;
  queryHash: string;
  traceId: string;
}

export interface MessageCitationSnapshot {
  id: string;
  assistantMessageId: string;
  candidateId: string;
  ordinal: number;
  sourceId: string;
  sourceTitle: string;
  documentId: string;
  documentVersion: number;
  documentContentHash: string;
  chunkId: string;
  chunkContentHash: string;
  heading: string | null;
  pageStart: number | null;
  pageEnd: number | null;
  availability: 'available' | 'superseded' | 'tombstoned';
  text: string | null;
  createdAt: string;
}

export class KnowledgeAccessError extends Error {
  readonly code = 'knowledge_turn_not_found';

  constructor() {
    super('知识检索对应的Session或Turn不存在或不属于当前学生');
    this.name = 'KnowledgeAccessError';
  }
}

export class KnowledgeSourceScopeError extends Error {
  readonly code = 'knowledge_source_out_of_scope';

  constructor() {
    super('课程资料不存在、已停用或不属于当前课程');
    this.name = 'KnowledgeSourceScopeError';
  }
}

export class SourceBindingConflictError extends Error {
  readonly code = 'source_binding_conflict';

  constructor() {
    super('资料选择幂等键已关联不同操作');
    this.name = 'SourceBindingConflictError';
  }
}

export class CitationCandidateInvalidError extends Error {
  readonly code = 'citation_candidate_invalid';

  constructor() {
    super('引用候选不属于本轮检索白名单');
    this.name = 'CitationCandidateInvalidError';
  }
}

export class CitationConflictError extends Error {
  readonly code = 'citation_conflict';

  constructor() {
    super('老师消息已关联不同引用集合');
    this.name = 'CitationConflictError';
  }
}

const SAFE_VERSION = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SAFE_MUTATION = SAFE_VERSION;

function toBindingSnapshot(
  row: typeof sessionSourceBindings.$inferSelect,
): SessionSourceBindingSnapshot {
  return { ...row, createdAt: row.createdAt.toISOString() };
}

function toTurnSourceSnapshot(
  row: typeof turnSourceVersions.$inferSelect,
): TurnSourceVersionSnapshot {
  return { ...row, createdAt: row.createdAt.toISOString() };
}

async function assertOwnedTurn(
  transaction: DatabaseTransaction,
  input: { trustedStudentId: string; sessionId: string; turnId: string },
): Promise<void> {
  const [owned] = await transaction
    .select({ sessionId: lessonSessions.id })
    .from(lessonSessions)
    .innerJoin(
      chatMessages,
      and(
        eq(chatMessages.sessionId, lessonSessions.id),
        eq(chatMessages.turnId, input.turnId),
      ),
    )
    .where(
      and(
        eq(lessonSessions.id, input.sessionId),
        eq(lessonSessions.studentId, input.trustedStudentId),
      ),
    )
    .limit(1);
  if (!owned) throw new KnowledgeAccessError();
}

async function assertOwnedAssistantMessage(
  transaction: DatabaseTransaction,
  input: {
    trustedStudentId: string;
    sessionId: string;
    turnId: string;
    assistantMessageId: string;
  },
): Promise<void> {
  const [owned] = await transaction
    .select({ messageId: chatMessages.id })
    .from(chatMessages)
    .innerJoin(lessonSessions, eq(lessonSessions.id, chatMessages.sessionId))
    .where(
      and(
        eq(chatMessages.id, input.assistantMessageId),
        eq(chatMessages.sessionId, input.sessionId),
        eq(chatMessages.turnId, input.turnId),
        eq(chatMessages.role, 'assistant'),
        eq(lessonSessions.studentId, input.trustedStudentId),
      ),
    )
    .limit(1);
  if (!owned) throw new KnowledgeAccessError();
}

function latestBindingQuery(
  transaction: DatabaseTransaction,
  sessionId: string,
) {
  return transaction
    .selectDistinctOn(
      [sessionSourceBindings.sessionId, sessionSourceBindings.sourceId],
      {
        sessionId: sessionSourceBindings.sessionId,
        sourceId: sessionSourceBindings.sourceId,
        enabled: sessionSourceBindings.enabled,
        sequence: sessionSourceBindings.sequence,
      },
    )
    .from(sessionSourceBindings)
    .where(eq(sessionSourceBindings.sessionId, sessionId))
    .orderBy(
      sessionSourceBindings.sessionId,
      sessionSourceBindings.sourceId,
      desc(sessionSourceBindings.sequence),
    )
    .as('latest_source_bindings');
}

async function loadCandidates(
  transaction: DatabaseTransaction,
  input: {
    sessionId: string;
    turnId: string;
    queryHash: string;
    retriever: string;
    retrieverVersion: string;
  },
): Promise<RetrievalCandidateEvidence[]> {
  const rows = await transaction
    .select({
      candidateId: retrievalCandidates.id,
      sessionId: retrievalCandidates.sessionId,
      turnId: retrievalCandidates.turnId,
      sourceId: turnSourceVersions.sourceId,
      sourceTitle: knowledgeSources.title,
      documentId: turnSourceVersions.documentId,
      documentVersion: turnSourceVersions.documentVersion,
      documentContentHash: turnSourceVersions.contentHash,
      chunkId: knowledgeChunks.id,
      chunkContentHash: knowledgeChunks.contentHash,
      text: knowledgeChunks.content,
      heading: knowledgeChunks.heading,
      pageStart: knowledgeChunks.pageStart,
      pageEnd: knowledgeChunks.pageEnd,
      retriever: retrievalCandidates.retriever,
      retrieverVersion: retrievalCandidates.retrieverVersion,
      rank: retrievalCandidates.rank,
      score: retrievalCandidates.score,
      queryHash: retrievalCandidates.queryHash,
      traceId: retrievalCandidates.traceId,
    })
    .from(retrievalCandidates)
    .innerJoin(
      turnSourceVersions,
      eq(turnSourceVersions.id, retrievalCandidates.turnSourceVersionId),
    )
    .innerJoin(
      knowledgeChunks,
      and(
        eq(knowledgeChunks.id, retrievalCandidates.chunkId),
        eq(knowledgeChunks.documentId, retrievalCandidates.documentId),
        eq(turnSourceVersions.documentId, retrievalCandidates.documentId),
      ),
    )
    .innerJoin(
      knowledgeSources,
      eq(knowledgeSources.id, turnSourceVersions.sourceId),
    )
    .where(
      and(
        eq(retrievalCandidates.sessionId, input.sessionId),
        eq(retrievalCandidates.turnId, input.turnId),
        eq(retrievalCandidates.queryHash, input.queryHash),
        eq(retrievalCandidates.retriever, input.retriever),
        eq(retrievalCandidates.retrieverVersion, input.retrieverVersion),
      ),
    )
    .orderBy(asc(retrievalCandidates.rank));
  return rows.map((row) => ({ ...row, score: Number(row.score) }));
}

/** 课程资料选择、Turn快照、FTS候选和引用白名单的同一数据库边界。 */
export class DrizzleKnowledgeRetrievalRepository {
  constructor(private readonly providedDatabase?: Database) {}

  private get database(): Database {
    return this.providedDatabase ?? getDb();
  }

  async setSessionSourceBinding(input: {
    trustedStudentId: string;
    sessionId: string;
    sourceId: string;
    enabled: boolean;
    mutationId: string;
    now?: Date;
  }): Promise<{ replayed: boolean; binding: SessionSourceBindingSnapshot }> {
    if (!SAFE_MUTATION.test(input.mutationId)) {
      throw new TypeError('mutationId必须为1-128位安全标识');
    }
    const lockKey = `session-source-binding-v1:${input.sessionId}:${input.sourceId}`;
    return this.database.transaction(async (transaction) => {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`,
      );
      const [scope] = await transaction
        .select({
          gradeBand: lessonSessions.gradeBand,
          courseSlug: lessonSessions.courseSlug,
          sourceGradeBand: knowledgeSources.gradeBand,
          sourceCourseSlug: knowledgeSources.courseSlug,
          sourceStatus: knowledgeSources.status,
        })
        .from(lessonSessions)
        .innerJoin(knowledgeSources, eq(knowledgeSources.id, input.sourceId))
        .where(
          and(
            eq(lessonSessions.id, input.sessionId),
            eq(lessonSessions.studentId, input.trustedStudentId),
          ),
        )
        .limit(1);
      if (!scope) throw new KnowledgeAccessError();
      if (
        scope.gradeBand !== scope.sourceGradeBand ||
        scope.courseSlug !== scope.sourceCourseSlug ||
        (input.enabled && scope.sourceStatus !== 'active')
      ) {
        throw new KnowledgeSourceScopeError();
      }
      const [existingMutation] = await transaction
        .select()
        .from(sessionSourceBindings)
        .where(
          and(
            eq(sessionSourceBindings.sessionId, input.sessionId),
            eq(sessionSourceBindings.mutationId, input.mutationId),
          ),
        )
        .limit(1);
      if (existingMutation) {
        if (
          existingMutation.sourceId !== input.sourceId ||
          existingMutation.enabled !== input.enabled
        ) {
          throw new SourceBindingConflictError();
        }
        return {
          replayed: true,
          binding: toBindingSnapshot(existingMutation),
        };
      }
      const [sequenceRow] = await transaction
        .select({ sequence: max(sessionSourceBindings.sequence) })
        .from(sessionSourceBindings)
        .where(
          and(
            eq(sessionSourceBindings.sessionId, input.sessionId),
            eq(sessionSourceBindings.sourceId, input.sourceId),
          ),
        );
      const [created] = await transaction
        .insert(sessionSourceBindings)
        .values({
          sessionId: input.sessionId,
          sourceId: input.sourceId,
          sequence: (sequenceRow?.sequence ?? 0) + 1,
          enabled: input.enabled,
          mutationId: input.mutationId,
          createdAt: input.now,
        })
        .returning();
      if (!created) throw new Error('资料选择事实写入失败');
      return { replayed: false, binding: toBindingSnapshot(created) };
    });
  }

  async freezeTurnSourceVersions(input: {
    trustedStudentId: string;
    sessionId: string;
    turnId: string;
    now?: Date;
  }): Promise<readonly TurnSourceVersionSnapshot[]> {
    const lockKey = `turn-source-snapshot-v1:${input.turnId}`;
    return this.database.transaction(async (transaction) => {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`,
      );
      await assertOwnedTurn(transaction, input);
      const [frozen] = await transaction
        .select({ id: turnSourceSnapshots.id })
        .from(turnSourceSnapshots)
        .where(
          and(
            eq(turnSourceSnapshots.sessionId, input.sessionId),
            eq(turnSourceSnapshots.turnId, input.turnId),
          ),
        )
        .limit(1);
      if (frozen) {
        const existing = await transaction
          .select()
          .from(turnSourceVersions)
          .where(
            and(
              eq(turnSourceVersions.sessionId, input.sessionId),
              eq(turnSourceVersions.turnId, input.turnId),
            ),
          )
          .orderBy(asc(turnSourceVersions.sourceId));
        return existing.map(toTurnSourceSnapshot);
      }

      const latestBindings = latestBindingQuery(transaction, input.sessionId);
      const activeBindings = await transaction
        .select({ sourceId: latestBindings.sourceId })
        .from(latestBindings)
        .innerJoin(
          knowledgeSources,
          eq(knowledgeSources.id, latestBindings.sourceId),
        )
        .where(
          and(
            eq(latestBindings.enabled, true),
            eq(knowledgeSources.status, 'active'),
          ),
        )
        .orderBy(asc(latestBindings.sourceId));
      for (const binding of activeBindings) {
        await transaction.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${knowledgeSourceLockKey(binding.sourceId)}, 0))`,
        );
      }
      let rows: (typeof turnSourceVersions.$inferSelect)[] = [];
      if (activeBindings.length > 0) {
        const readyDocuments = await transaction
          .select()
          .from(knowledgeDocuments)
          .where(
            and(
              inArray(
                knowledgeDocuments.sourceId,
                activeBindings.map((binding) => binding.sourceId),
              ),
              eq(knowledgeDocuments.parseStatus, 'ready'),
            ),
          )
          .orderBy(asc(knowledgeDocuments.sourceId));
        if (readyDocuments.length > 0) {
          rows = await transaction
            .insert(turnSourceVersions)
            .values(
              readyDocuments.map((document) => ({
                sessionId: input.sessionId,
                turnId: input.turnId,
                sourceId: document.sourceId,
                documentId: document.id,
                documentVersion: document.version,
                contentHash: document.contentHash,
                createdAt: input.now,
              })),
            )
            .returning();
        }
      }
      await transaction.insert(turnSourceSnapshots).values({
        sessionId: input.sessionId,
        turnId: input.turnId,
        createdAt: input.now,
      });
      return rows.map(toTurnSourceSnapshot);
    });
  }

  async retrieveFts(input: {
    trustedStudentId: string;
    sessionId: string;
    turnId: string;
    query: string;
    limit: number;
    traceId: string;
    retrieverVersion?: string;
    now?: Date;
  }): Promise<{
    replayed: boolean;
    queryHash: string;
    candidates: readonly RetrievalCandidateEvidence[];
  }> {
    const query = input.query.trim().replace(/\s+/g, ' ');
    if (query.length < 1 || query.length > 4_096) {
      throw new TypeError('FTS查询长度必须为1-4096');
    }
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 50) {
      throw new TypeError('FTS limit必须为1-50的整数');
    }
    const retriever = 'postgres_fts';
    const retrieverVersion = input.retrieverVersion ?? 'simple-v1';
    if (!SAFE_VERSION.test(retrieverVersion)) {
      throw new TypeError('retrieverVersion必须为安全版本标识');
    }
    const queryHash = hashKnowledgeText(query);
    const lockKey = `turn-retrieval-v1:${input.turnId}:${queryHash}:${retrieverVersion}`;
    return this.database.transaction(async (transaction) => {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`,
      );
      await assertOwnedTurn(transaction, input);
      const existing = await loadCandidates(transaction, {
        sessionId: input.sessionId,
        turnId: input.turnId,
        queryHash,
        retriever,
        retrieverVersion,
      });
      if (existing.length > 0) {
        return { replayed: true, queryHash, candidates: existing };
      }

      const searchQuery = sql`websearch_to_tsquery('simple', ${query})`;
      const score = sql<number>`ts_rank_cd(${knowledgeChunks.searchVector}, ${searchQuery}, 32)`;
      const matches = await transaction
        .select({
          turnSourceVersionId: turnSourceVersions.id,
          chunkId: knowledgeChunks.id,
          documentId: turnSourceVersions.documentId,
          score,
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
        .limit(input.limit);
      if (matches.length === 0) {
        return { replayed: false, queryHash, candidates: [] };
      }
      await transaction.insert(retrievalCandidates).values(
        matches.map((match, index) => ({
          sessionId: input.sessionId,
          turnId: input.turnId,
          turnSourceVersionId: match.turnSourceVersionId,
          chunkId: match.chunkId,
          documentId: match.documentId,
          retriever,
          retrieverVersion,
          rank: index + 1,
          score: Number(match.score),
          queryHash,
          traceId: input.traceId,
          createdAt: input.now,
        })),
      );
      const candidates = await loadCandidates(transaction, {
        sessionId: input.sessionId,
        turnId: input.turnId,
        queryHash,
        retriever,
        retrieverVersion,
      });
      return { replayed: false, queryHash, candidates };
    });
  }

  async persistMessageCitations(input: {
    trustedStudentId: string;
    sessionId: string;
    turnId: string;
    assistantMessageId: string;
    candidateIds: readonly string[];
    /** 文中标记号(与 candidateIds 对齐、升序、1..99);缺省退化为 1..N 顺号。
        提供时 ordinal 语义 = 模型在正文中实际标注的 [n],驱动行内引用。 */
    markers?: readonly number[];
    now?: Date;
  }): Promise<{
    replayed: boolean;
    citations: readonly MessageCitationSnapshot[];
  }> {
    if (
      input.candidateIds.length < 1 ||
      input.candidateIds.length > 50 ||
      new Set(input.candidateIds).size !== input.candidateIds.length
    ) {
      throw new CitationCandidateInvalidError();
    }
    if (input.markers !== undefined) {
      const markers = input.markers;
      const ascendingUnique = markers.every(
        (marker, index) =>
          Number.isInteger(marker) &&
          marker >= 1 &&
          marker <= 99 &&
          (index === 0 || marker > markers[index - 1]!),
      );
      if (markers.length !== input.candidateIds.length || !ascendingUnique) {
        throw new CitationCandidateInvalidError();
      }
    }
    const lockKey = `message-citations-v1:${input.assistantMessageId}`;
    return this.database.transaction(async (transaction) => {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`,
      );
      await assertOwnedAssistantMessage(transaction, input);
      const existing = await transaction
        .select({
          candidateId: messageCitations.retrievalCandidateId,
          ordinal: messageCitations.ordinal,
        })
        .from(messageCitations)
        .where(
          eq(messageCitations.assistantMessageId, input.assistantMessageId),
        )
        .orderBy(asc(messageCitations.ordinal));
      if (existing.length > 0) {
        if (
          existing.length !== input.candidateIds.length ||
          existing.some(
            (citation, index) =>
              citation.candidateId !== input.candidateIds[index] ||
              citation.ordinal !== (input.markers?.[index] ?? index + 1),
          )
        ) {
          throw new CitationConflictError();
        }
        return {
          replayed: true,
          citations: await this.loadOwnedCitations(transaction, input),
        };
      }

      const candidates = await transaction
        .select({
          candidateId: retrievalCandidates.id,
          snapshotSourceId: turnSourceVersions.sourceId,
          snapshotDocumentId: turnSourceVersions.documentId,
          snapshotDocumentVersion: turnSourceVersions.documentVersion,
          snapshotContentHash: turnSourceVersions.contentHash,
          documentSourceId: knowledgeDocuments.sourceId,
          documentVersion: knowledgeDocuments.version,
          documentContentHash: knowledgeDocuments.contentHash,
          chunkDocumentId: knowledgeChunks.documentId,
        })
        .from(retrievalCandidates)
        .innerJoin(
          turnSourceVersions,
          eq(turnSourceVersions.id, retrievalCandidates.turnSourceVersionId),
        )
        .innerJoin(
          knowledgeChunks,
          eq(knowledgeChunks.id, retrievalCandidates.chunkId),
        )
        .innerJoin(
          knowledgeDocuments,
          eq(knowledgeDocuments.id, turnSourceVersions.documentId),
        )
        .where(
          and(
            inArray(retrievalCandidates.id, [...input.candidateIds]),
            eq(retrievalCandidates.sessionId, input.sessionId),
            eq(retrievalCandidates.turnId, input.turnId),
            eq(turnSourceVersions.sessionId, input.sessionId),
            eq(turnSourceVersions.turnId, input.turnId),
          ),
        );
      if (
        candidates.length !== input.candidateIds.length ||
        candidates.some(
          (candidate) =>
            candidate.snapshotDocumentId !== candidate.chunkDocumentId ||
            candidate.snapshotSourceId !== candidate.documentSourceId ||
            candidate.snapshotDocumentVersion !== candidate.documentVersion ||
            candidate.snapshotContentHash !== candidate.documentContentHash,
        )
      ) {
        throw new CitationCandidateInvalidError();
      }
      const candidateSet = new Set(
        candidates.map((candidate) => candidate.candidateId),
      );
      if (
        input.candidateIds.some((candidateId) => !candidateSet.has(candidateId))
      ) {
        throw new CitationCandidateInvalidError();
      }
      await transaction.insert(messageCitations).values(
        input.candidateIds.map((candidateId, index) => ({
          sessionId: input.sessionId,
          turnId: input.turnId,
          assistantMessageId: input.assistantMessageId,
          retrievalCandidateId: candidateId,
          ordinal: input.markers?.[index] ?? index + 1,
          createdAt: input.now,
        })),
      );
      return {
        replayed: false,
        citations: await this.loadOwnedCitations(transaction, input),
      };
    });
  }

  async listOwnedMessageCitations(input: {
    trustedStudentId: string;
    sessionId: string;
    turnId: string;
    assistantMessageId: string;
  }): Promise<readonly MessageCitationSnapshot[]> {
    return this.database.transaction(async (transaction) => {
      await assertOwnedAssistantMessage(transaction, input);
      return this.loadOwnedCitations(transaction, input);
    });
  }

  private async loadOwnedCitations(
    transaction: DatabaseTransaction,
    input: { sessionId: string; turnId: string; assistantMessageId: string },
  ): Promise<MessageCitationSnapshot[]> {
    const rows = await transaction
      .select({
        id: messageCitations.id,
        assistantMessageId: messageCitations.assistantMessageId,
        candidateId: retrievalCandidates.id,
        ordinal: messageCitations.ordinal,
        sourceId: knowledgeSources.id,
        sourceTitle: knowledgeSources.title,
        sourceStatus: knowledgeSources.status,
        documentId: knowledgeDocuments.id,
        documentVersion: knowledgeDocuments.version,
        documentContentHash: knowledgeDocuments.contentHash,
        documentStatus: knowledgeDocuments.parseStatus,
        chunkId: knowledgeChunks.id,
        chunkContentHash: knowledgeChunks.contentHash,
        text: knowledgeChunks.content,
        heading: knowledgeChunks.heading,
        pageStart: knowledgeChunks.pageStart,
        pageEnd: knowledgeChunks.pageEnd,
        createdAt: messageCitations.createdAt,
      })
      .from(messageCitations)
      .innerJoin(
        retrievalCandidates,
        eq(retrievalCandidates.id, messageCitations.retrievalCandidateId),
      )
      .innerJoin(
        turnSourceVersions,
        eq(turnSourceVersions.id, retrievalCandidates.turnSourceVersionId),
      )
      .innerJoin(
        knowledgeSources,
        eq(knowledgeSources.id, turnSourceVersions.sourceId),
      )
      .innerJoin(
        knowledgeDocuments,
        eq(knowledgeDocuments.id, turnSourceVersions.documentId),
      )
      .innerJoin(
        knowledgeChunks,
        eq(knowledgeChunks.id, retrievalCandidates.chunkId),
      )
      .where(
        and(
          eq(messageCitations.sessionId, input.sessionId),
          eq(messageCitations.turnId, input.turnId),
          eq(messageCitations.assistantMessageId, input.assistantMessageId),
        ),
      )
      .orderBy(asc(messageCitations.ordinal));
    return rows.map((row) => {
      const availability: MessageCitationSnapshot['availability'] =
        row.sourceStatus === 'tombstoned' || row.documentStatus === 'tombstoned'
          ? 'tombstoned'
          : row.documentStatus === 'superseded'
            ? 'superseded'
            : 'available';
      return {
        id: row.id,
        assistantMessageId: row.assistantMessageId,
        candidateId: row.candidateId,
        ordinal: row.ordinal,
        sourceId: row.sourceId,
        sourceTitle: row.sourceTitle,
        documentId: row.documentId,
        documentVersion: row.documentVersion,
        documentContentHash: row.documentContentHash,
        chunkId: row.chunkId,
        chunkContentHash: row.chunkContentHash,
        heading: row.heading,
        pageStart: row.pageStart,
        pageEnd: row.pageEnd,
        availability,
        text: availability === 'available' ? row.text : null,
        createdAt: row.createdAt.toISOString(),
      };
    });
  }
}
