import { eq, inArray, sql } from 'drizzle-orm';
import { getDb } from './client';
import {
  agentOperations,
  artifacts,
  canvasArtifacts,
  conversationMessages,
  conversations,
  lessonSessions,
} from './schema';
import {
  anonymousLifecycleDefinitions,
  type AnonymousDataOwnershipPath,
  type AnonymousLifecycleDeletionContext,
} from './anonymous-data-lifecycle-deletions';

export type { AnonymousDataOwnershipPath } from './anonymous-data-lifecycle-deletions';

type Database = ReturnType<typeof getDb>;

/** shared-dev 匿名合成主体的完整保留期。边界按严格“小于cutoff”判断。 */
export const ANONYMOUS_SUBJECT_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;

const ANONYMOUS_SUBJECT_PATTERN = /^anon:v1:[a-f0-9]{64}$/;
const ANONYMOUS_SUBJECT_SQL_PATTERN = '^anon:v1:[a-f0-9]{64}$';

export function isAnonymousSyntheticSubjectId(value: string): boolean {
  return ANONYMOUS_SUBJECT_PATTERN.test(value);
}

/** Session创建路径和清理路径共用该锁，避免清理已过期主体时并发创建新Session。 */
export function anonymousSubjectLockKey(subjectId: string): string {
  return `anonymous-subject-lifecycle-v1:${subjectId}`;
}

export type AnonymousDataLifecycleTableName =
  (typeof anonymousLifecycleDefinitions)[number]['tableName'];

export interface AnonymousDataLifecycleRegistryEntry {
  tableName: AnonymousDataLifecycleTableName;
  ownershipPath: AnonymousDataOwnershipPath;
  deletionOrder: number;
}

export const ANONYMOUS_DATA_LIFECYCLE_REGISTRY = Object.freeze(
  anonymousLifecycleDefinitions.map(
    (definition, index): AnonymousDataLifecycleRegistryEntry => ({
      tableName: definition.tableName,
      ownershipPath: definition.ownershipPath,
      deletionOrder: index + 1,
    }),
  ),
);

/**
 * 供K1/T1/C1及后续迁移测试传入其“已知subject-owned表”清单。缺失或陈旧注册项都会失败，
 * 使新增关联表不能绕过生命周期闭包。
 */
export function assertAnonymousDataLifecycleRegistryCoverage(
  knownSubjectOwnedTables: readonly string[],
): void {
  const registered = new Set<string>(
    ANONYMOUS_DATA_LIFECYCLE_REGISTRY.map((entry) => entry.tableName),
  );
  const known = new Set(knownSubjectOwnedTables);
  const missing = [...known].filter((tableName) => !registered.has(tableName));
  const unexpected = [...registered].filter(
    (tableName) => !known.has(tableName),
  );
  if (missing.length > 0 || unexpected.length > 0) {
    throw new Error(
      `匿名数据生命周期注册表不完整；missing=${missing.join(',') || '-'}; unexpected=${unexpected.join(',') || '-'}`,
    );
  }
}

export interface AnonymousLifecycleTestHooks {
  /** 只允许测试注入故障以证明事务回滚；生产代码不得用它承载业务逻辑。 */
  afterDeleteTable?(tableName: AnonymousDataLifecycleTableName): Promise<void>;
}

export interface PurgeExpiredAnonymousSubjectsInput {
  now?: Date;
  limit?: number;
  testHooks?: AnonymousLifecycleTestHooks;
}

export interface PurgeExpiredAnonymousSubjectsResult {
  evaluatedSubjects: number;
  deletedSubjects: number;
  skippedSubjects: number;
  deletedRows: Readonly<Record<AnonymousDataLifecycleTableName, number>>;
}

function emptyDeleteCounts(): Record<AnonymousDataLifecycleTableName, number> {
  return Object.fromEntries(
    ANONYMOUS_DATA_LIFECYCLE_REGISTRY.map((entry) => [entry.tableName, 0]),
  ) as Record<AnonymousDataLifecycleTableName, number>;
}

function isSerializationFailure(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === '40001'
  );
}

/**
 * shared-dev匿名合成主体清理服务。候选扫描只接受anon:v1哈希主体；每个主体独立使用
 * SERIALIZABLE事务，任一Session达到7天窗口内即不删除任何表。
 */
export class DrizzleAnonymousDataLifecycleService {
  constructor(private readonly providedDatabase?: Database) {}

  private get database(): Database {
    return this.providedDatabase ?? getDb();
  }

  async purgeExpiredSubjects(
    input: PurgeExpiredAnonymousSubjectsInput = {},
  ): Promise<PurgeExpiredAnonymousSubjectsResult> {
    const now = input.now ?? new Date();
    if (Number.isNaN(now.getTime())) throw new TypeError('now必须是有效时间');
    const limit = input.limit ?? 100;
    if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) {
      throw new TypeError('limit必须是1-1000的整数');
    }
    const cutoff = new Date(now.getTime() - ANONYMOUS_SUBJECT_RETENTION_MS);
    const candidates = await this.database.execute<{ subjectId: string }>(sql`
      with subject_activity as (
        select ${lessonSessions.studentId} as subject_id,
               ${lessonSessions.lastActivityAt} as activity_at
        from ${lessonSessions}
        where ${lessonSessions.studentId} ~ ${ANONYMOUS_SUBJECT_SQL_PATTERN}
        union all
        select ${conversations.ownerSubjectId} as subject_id,
               ${conversations.lastActivityAt} as activity_at
        from ${conversations}
        where ${conversations.ownerSubjectId} ~ ${ANONYMOUS_SUBJECT_SQL_PATTERN}
      )
      select subject_id as "subjectId"
      from subject_activity
      group by subject_id
      having max(activity_at) < ${cutoff.toISOString()}::timestamptz
      order by subject_id
      limit ${limit}
    `);

    const deletedRows = emptyDeleteCounts();
    let deletedSubjects = 0;
    let skippedSubjects = 0;
    for (const candidate of candidates) {
      const result = await this.purgeSubjectWithRetry(
        candidate.subjectId,
        cutoff,
        input.testHooks,
      );
      if (!result) {
        skippedSubjects += 1;
        continue;
      }
      deletedSubjects += 1;
      for (const tableName of Object.keys(
        result,
      ) as AnonymousDataLifecycleTableName[]) {
        deletedRows[tableName] += result[tableName];
      }
    }

    return {
      evaluatedSubjects: candidates.length,
      deletedSubjects,
      skippedSubjects,
      deletedRows,
    };
  }

  private async purgeSubjectWithRetry(
    subjectId: string,
    cutoff: Date,
    testHooks?: AnonymousLifecycleTestHooks,
  ): Promise<Record<AnonymousDataLifecycleTableName, number> | null> {
    if (!isAnonymousSyntheticSubjectId(subjectId)) {
      throw new TypeError('只允许清理anon:v1合成主体');
    }
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        return await this.purgeSubject(subjectId, cutoff, testHooks);
      } catch (error) {
        if (!isSerializationFailure(error) || attempt === 3) throw error;
      }
    }
    throw new Error('匿名主体清理重试状态异常');
  }

  private purgeSubject(
    subjectId: string,
    cutoff: Date,
    testHooks?: AnonymousLifecycleTestHooks,
  ): Promise<Record<AnonymousDataLifecycleTableName, number> | null> {
    return this.database.transaction(
      async (transaction) => {
        await transaction.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${anonymousSubjectLockKey(subjectId)}, 0))`,
        );
        const sessions = await transaction
          .select({
            id: lessonSessions.id,
            lastActivityAt: lessonSessions.lastActivityAt,
          })
          .from(lessonSessions)
          .where(eq(lessonSessions.studentId, subjectId))
          .for('update');
        const ownedConversations = await transaction
          .select({
            id: conversations.id,
            lastActivityAt: conversations.lastActivityAt,
          })
          .from(conversations)
          .where(eq(conversations.ownerSubjectId, subjectId))
          .for('update');
        if (
          (sessions.length === 0 && ownedConversations.length === 0) ||
          sessions.some((session) => session.lastActivityAt >= cutoff) ||
          ownedConversations.some(
            (conversation) => conversation.lastActivityAt >= cutoff,
          )
        ) {
          return null;
        }

        const sessionIds = sessions.map((session) => session.id);
        const lessonArtifacts =
          sessionIds.length === 0
            ? []
            : await transaction
                .select({ id: canvasArtifacts.id })
                .from(canvasArtifacts)
                .where(inArray(canvasArtifacts.sessionId, sessionIds));
        const conversationIds = ownedConversations.map(
          (conversation) => conversation.id,
        );
        const ownedOperations =
          conversationIds.length === 0
            ? []
            : await transaction
                .select({ id: agentOperations.id })
                .from(agentOperations)
                .where(
                  inArray(agentOperations.conversationId, conversationIds),
                );
        const ownedMessages =
          conversationIds.length === 0
            ? []
            : await transaction
                .select({ id: conversationMessages.id })
                .from(conversationMessages)
                .where(
                  inArray(conversationMessages.conversationId, conversationIds),
                );
        const ownedPlatformArtifacts = await transaction
          .select({ id: artifacts.id })
          .from(artifacts)
          .where(eq(artifacts.ownerSubjectId, subjectId));
        const context: AnonymousLifecycleDeletionContext = {
          transaction,
          subjectId,
          sessionIds,
          artifactRecordIds: lessonArtifacts.map((artifact) => artifact.id),
          conversationIds,
          operationIds: ownedOperations.map((operation) => operation.id),
          conversationMessageIds: ownedMessages.map((message) => message.id),
          platformArtifactIds: ownedPlatformArtifacts.map(
            (artifact) => artifact.id,
          ),
        };
        const deletedRows = emptyDeleteCounts();
        for (const definition of anonymousLifecycleDefinitions) {
          deletedRows[definition.tableName] =
            await definition.deleteRows(context);
          await testHooks?.afterDeleteTable?.(definition.tableName);
        }

        const remainingSessions = await transaction
          .select({ id: lessonSessions.id })
          .from(lessonSessions)
          .where(eq(lessonSessions.studentId, subjectId))
          .limit(1);
        const remainingConversations = await transaction
          .select({ id: conversations.id })
          .from(conversations)
          .where(eq(conversations.ownerSubjectId, subjectId))
          .limit(1);
        if (remainingSessions.length > 0 || remainingConversations.length > 0) {
          throw new Error(
            '匿名主体清理期间出现未纳入锁定快照的新Session或Conversation',
          );
        }
        return deletedRows;
      },
      { isolationLevel: 'serializable', accessMode: 'read write' },
    );
  }
}
