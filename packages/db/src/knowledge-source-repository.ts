import { createHash } from 'node:crypto';
import { and, asc, desc, eq, max, sql } from 'drizzle-orm';
import { isDeepStrictEqual } from 'node:util';
import { getDb } from './client';
import {
  knowledgeChunks,
  knowledgeDocuments,
  knowledgeSources,
} from './schema';

type Database = ReturnType<typeof getDb>;

export type KnowledgeSourceType = 'text' | 'pdf';
export type KnowledgeDocumentStatus =
  'ready' | 'parse_failed' | 'superseded' | 'tombstoned';

export interface KnowledgeSourceSnapshot {
  id: string;
  gradeBand: string;
  courseSlug: string;
  sourceKey: string;
  title: string;
  sourceType: KnowledgeSourceType;
  status: 'active' | 'tombstoned';
  tombstonedAt: string | null;
  createdAt: string;
}

export interface KnowledgeDocumentSnapshot {
  id: string;
  sourceId: string;
  version: number;
  contentHash: string;
  objectKey: string;
  parserVersion: string;
  parseStatus: KnowledgeDocumentStatus;
  failureCode: string | null;
  parsedAt: string;
  createdAt: string;
}

export interface IngestKnowledgeChunkInput {
  content: string;
  contentHash?: string;
  heading?: string | null;
  pageStart?: number | null;
  pageEnd?: number | null;
}

export interface IngestKnowledgeDocumentInput {
  sourceId: string;
  contentHash: string;
  objectKey: string;
  parserVersion: string;
  outcome:
    | { status: 'ready'; chunks: readonly IngestKnowledgeChunkInput[] }
    | { status: 'parse_failed'; failureCode: string };
  now?: Date;
}

export interface IngestedKnowledgeDocument {
  replayed: boolean;
  document: KnowledgeDocumentSnapshot;
}

export class KnowledgeSourceConflictError extends Error {
  readonly code = 'knowledge_source_conflict';

  constructor() {
    super('课程资料标识已存在但不可变元数据不同');
    this.name = 'KnowledgeSourceConflictError';
  }
}

export class KnowledgeDocumentConflictError extends Error {
  readonly code = 'knowledge_document_conflict';

  constructor() {
    super('资料hash已存在但不可变版本内容不同');
    this.name = 'KnowledgeDocumentConflictError';
  }
}

export class KnowledgeSourceNotAvailableError extends Error {
  readonly code = 'knowledge_source_not_available';

  constructor() {
    super('课程资料不存在或已停用');
    this.name = 'KnowledgeSourceNotAvailableError';
  }
}

const SAFE_VERSION = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SHA256 = /^[a-f0-9]{64}$/;

export function hashKnowledgeText(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function knowledgeSourceLockKey(sourceId: string): string {
  return `knowledge-source-version-v1:${sourceId}`;
}

function requireText(value: string, field: string, maximum: number): string {
  if (value.length < 1 || value.length > maximum) {
    throw new TypeError(`${field}长度必须为1-${maximum}`);
  }
  return value;
}

function requireHash(value: string, field: string): string {
  if (!SHA256.test(value)) throw new TypeError(`${field}必须为小写SHA-256`);
  return value;
}

function requireVersion(value: string): string {
  if (!SAFE_VERSION.test(value)) {
    throw new TypeError('parserVersion必须为1-128位安全版本标识');
  }
  return value;
}

function toSourceSnapshot(
  row: typeof knowledgeSources.$inferSelect,
): KnowledgeSourceSnapshot {
  return {
    id: row.id,
    gradeBand: row.gradeBand,
    courseSlug: row.courseSlug,
    sourceKey: row.sourceKey,
    title: row.title,
    sourceType: row.sourceType as KnowledgeSourceType,
    status: row.status as 'active' | 'tombstoned',
    tombstonedAt: row.tombstonedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function toDocumentSnapshot(
  row: typeof knowledgeDocuments.$inferSelect,
): KnowledgeDocumentSnapshot {
  return {
    id: row.id,
    sourceId: row.sourceId,
    version: row.version,
    contentHash: row.contentHash,
    objectKey: row.objectKey,
    parserVersion: row.parserVersion,
    parseStatus: row.parseStatus as KnowledgeDocumentStatus,
    failureCode: row.failureCode,
    parsedAt: row.parsedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

function prepareChunks(chunks: readonly IngestKnowledgeChunkInput[]) {
  if (chunks.length < 1 || chunks.length > 10_000) {
    throw new TypeError('ready资料必须包含1-10000个chunk');
  }
  return chunks.map((chunk, chunkIndex) => {
    const content = requireText(chunk.content, 'chunk.content', 20_000);
    const computedHash = hashKnowledgeText(content);
    if (chunk.contentHash && chunk.contentHash !== computedHash) {
      throw new TypeError('chunk.contentHash与正文不一致');
    }
    const heading = chunk.heading ?? null;
    if (heading !== null) requireText(heading, 'chunk.heading', 500);
    const pageStart = chunk.pageStart ?? null;
    const pageEnd = chunk.pageEnd ?? null;
    if (
      (pageStart === null) !== (pageEnd === null) ||
      (pageStart !== null &&
        (!Number.isInteger(pageStart) ||
          !Number.isInteger(pageEnd) ||
          pageStart < 1 ||
          pageEnd! < pageStart))
    ) {
      throw new TypeError('chunk页码范围无效');
    }
    return {
      chunkIndex,
      contentHash: computedHash,
      content,
      heading,
      pageStart,
      pageEnd,
    };
  });
}

/** 受控摄取任务使用的唯一写入口；不提供任意URL抓取或学生上传能力。 */
export class DrizzleKnowledgeSourceRepository {
  constructor(private readonly providedDatabase?: Database) {}

  private get database(): Database {
    return this.providedDatabase ?? getDb();
  }

  async createOrGetSource(input: {
    gradeBand: string;
    courseSlug: string;
    sourceKey: string;
    title: string;
    sourceType: KnowledgeSourceType;
    now?: Date;
  }): Promise<{ replayed: boolean; source: KnowledgeSourceSnapshot }> {
    requireText(input.gradeBand, 'gradeBand', 64);
    requireText(input.courseSlug, 'courseSlug', 128);
    requireText(input.sourceKey, 'sourceKey', 128);
    requireText(input.title, 'title', 300);
    if (input.sourceType !== 'text' && input.sourceType !== 'pdf') {
      throw new TypeError('sourceType只支持text或pdf');
    }
    const lockKey = [
      'knowledge-source-scope-v1',
      input.gradeBand,
      input.courseSlug,
      input.sourceKey,
    ].join(':');
    return this.database.transaction(async (transaction) => {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`,
      );
      const [existing] = await transaction
        .select()
        .from(knowledgeSources)
        .where(
          and(
            eq(knowledgeSources.gradeBand, input.gradeBand),
            eq(knowledgeSources.courseSlug, input.courseSlug),
            eq(knowledgeSources.sourceKey, input.sourceKey),
          ),
        )
        .limit(1);
      if (existing) {
        if (
          existing.title !== input.title ||
          existing.sourceType !== input.sourceType
        ) {
          throw new KnowledgeSourceConflictError();
        }
        return { replayed: true, source: toSourceSnapshot(existing) };
      }
      const [created] = await transaction
        .insert(knowledgeSources)
        .values({ ...input, createdAt: input.now })
        .returning();
      if (!created) throw new Error('课程资料创建失败');
      return { replayed: false, source: toSourceSnapshot(created) };
    });
  }

  async ingestDocument(
    input: IngestKnowledgeDocumentInput,
  ): Promise<IngestedKnowledgeDocument> {
    const contentHash = requireHash(input.contentHash, 'contentHash');
    const objectKey = requireText(input.objectKey, 'objectKey', 1_024);
    if (/^https?:\/\//i.test(objectKey)) {
      throw new TypeError('objectKey不能是公开URL');
    }
    const parserVersion = requireVersion(input.parserVersion);
    const chunks =
      input.outcome.status === 'ready'
        ? prepareChunks(input.outcome.chunks)
        : [];
    const failureCode =
      input.outcome.status === 'parse_failed'
        ? requireText(input.outcome.failureCode, 'failureCode', 128)
        : null;
    const now = input.now ?? new Date();

    return this.database.transaction(async (transaction) => {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${knowledgeSourceLockKey(input.sourceId)}, 0))`,
      );
      const [source] = await transaction
        .select()
        .from(knowledgeSources)
        .where(eq(knowledgeSources.id, input.sourceId))
        .limit(1);
      if (!source || source.status !== 'active') {
        throw new KnowledgeSourceNotAvailableError();
      }
      const [existing] = await transaction
        .select()
        .from(knowledgeDocuments)
        .where(
          and(
            eq(knowledgeDocuments.sourceId, input.sourceId),
            eq(knowledgeDocuments.contentHash, contentHash),
          ),
        )
        .limit(1);
      if (existing) {
        const existingChunks = await transaction
          .select({
            chunkIndex: knowledgeChunks.chunkIndex,
            contentHash: knowledgeChunks.contentHash,
            content: knowledgeChunks.content,
            heading: knowledgeChunks.heading,
            pageStart: knowledgeChunks.pageStart,
            pageEnd: knowledgeChunks.pageEnd,
          })
          .from(knowledgeChunks)
          .where(eq(knowledgeChunks.documentId, existing.id))
          .orderBy(asc(knowledgeChunks.chunkIndex));
        const expectedStatus = input.outcome.status;
        if (
          existing.objectKey !== objectKey ||
          existing.parserVersion !== parserVersion ||
          (existing.parseStatus !== expectedStatus &&
            !(
              expectedStatus === 'ready' &&
              ['superseded', 'tombstoned'].includes(existing.parseStatus)
            )) ||
          existing.failureCode !== failureCode ||
          !isDeepStrictEqual(existingChunks, chunks)
        ) {
          throw new KnowledgeDocumentConflictError();
        }
        return { replayed: true, document: toDocumentSnapshot(existing) };
      }

      const [versionRow] = await transaction
        .select({ version: max(knowledgeDocuments.version) })
        .from(knowledgeDocuments)
        .where(eq(knowledgeDocuments.sourceId, input.sourceId));
      const version = (versionRow?.version ?? 0) + 1;
      if (input.outcome.status === 'ready') {
        await transaction
          .update(knowledgeDocuments)
          .set({ parseStatus: 'superseded' })
          .where(
            and(
              eq(knowledgeDocuments.sourceId, input.sourceId),
              eq(knowledgeDocuments.parseStatus, 'ready'),
            ),
          );
      }
      const [document] = await transaction
        .insert(knowledgeDocuments)
        .values({
          sourceId: input.sourceId,
          version,
          contentHash,
          objectKey,
          parserVersion,
          parseStatus: input.outcome.status,
          failureCode,
          parsedAt: now,
          createdAt: now,
        })
        .returning();
      if (!document) throw new Error('资料版本创建失败');
      if (chunks.length > 0) {
        await transaction.insert(knowledgeChunks).values(
          chunks.map((chunk) => ({
            documentId: document.id,
            ...chunk,
            createdAt: now,
          })),
        );
      }
      return { replayed: false, document: toDocumentSnapshot(document) };
    });
  }

  async listDocuments(sourceId: string): Promise<KnowledgeDocumentSnapshot[]> {
    const rows = await this.database
      .select()
      .from(knowledgeDocuments)
      .where(eq(knowledgeDocuments.sourceId, sourceId))
      .orderBy(desc(knowledgeDocuments.version));
    return rows.map(toDocumentSnapshot);
  }

  async tombstoneSource(sourceId: string, now = new Date()): Promise<void> {
    await this.database.transaction(async (transaction) => {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${knowledgeSourceLockKey(sourceId)}, 0))`,
      );
      const [source] = await transaction
        .select({ status: knowledgeSources.status })
        .from(knowledgeSources)
        .where(eq(knowledgeSources.id, sourceId))
        .limit(1);
      if (!source) throw new KnowledgeSourceNotAvailableError();
      if (source.status === 'tombstoned') return;
      await transaction
        .update(knowledgeDocuments)
        .set({ parseStatus: 'tombstoned' })
        .where(
          and(
            eq(knowledgeDocuments.sourceId, sourceId),
            eq(knowledgeDocuments.parseStatus, 'ready'),
          ),
        );
      await transaction
        .update(knowledgeSources)
        .set({ status: 'tombstoned', tombstonedAt: now })
        .where(eq(knowledgeSources.id, sourceId));
    });
  }
}
