import { eq, inArray, sql } from 'drizzle-orm';
import { getDb } from './client';
import {
  agentOperations,
  agentMessageParts,
  artifactGenerationJobs,
  artifacts,
  artifactVersions,
  assets,
  assetVersions,
  canvasArtifactGradingKeys,
  canvasArtifacts,
  chatMessages,
  conversationMessageCitations,
  conversationMessages,
  conversations,
  learningEvents,
  lessonSessions,
  masteryStates,
  messageCitations,
  modelRuns,
  operationSources,
  retrievalCandidates,
  sessionSourceBindings,
  spaces,
  toolCalls,
  turnSafetyDecisions,
  turnSourceSnapshots,
  turnSourceVersions,
} from './schema';

type Database = ReturnType<typeof getDb>;
type DatabaseTransaction = Parameters<
  Parameters<Database['transaction']>[0]
>[0];

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

export type AnonymousDataOwnershipPath =
  | 'session_id'
  | 'message_id -> chat_messages.session_id'
  | 'artifact_record_id -> canvas_artifacts.session_id'
  | 'message_id -> conversation_messages.conversation_id'
  | 'operation_id -> agent_operations.conversation_id'
  | 'artifact_id -> artifacts.owner_subject_id'
  | 'conversation_id -> conversations.owner_subject_id'
  | 'asset_id -> assets.owner_subject_id'
  | 'owner_subject_id'
  | 'student_id';

interface AnonymousLifecycleDeletionContext {
  transaction: DatabaseTransaction;
  subjectId: string;
  sessionIds: readonly string[];
  artifactRecordIds: readonly string[];
  conversationIds: readonly string[];
  operationIds: readonly string[];
  conversationMessageIds: readonly string[];
  platformArtifactIds: readonly string[];
}

interface AnonymousLifecycleDefinition {
  tableName: string;
  ownershipPath: AnonymousDataOwnershipPath;
  deleteRows(context: AnonymousLifecycleDeletionContext): Promise<number>;
}

async function deleteConversationMessageCitations(
  context: AnonymousLifecycleDeletionContext,
): Promise<number> {
  if (context.conversationMessageIds.length === 0) return 0;
  return (
    await context.transaction
      .delete(conversationMessageCitations)
      .where(
        inArray(conversationMessageCitations.assistantMessageId, [
          ...context.conversationMessageIds,
        ]),
      )
      .returning({ id: conversationMessageCitations.id })
  ).length;
}

async function deleteOperationSources(
  context: AnonymousLifecycleDeletionContext,
): Promise<number> {
  if (context.operationIds.length === 0) return 0;
  return (
    await context.transaction
      .delete(operationSources)
      .where(inArray(operationSources.operationId, [...context.operationIds]))
      .returning({ id: operationSources.id })
  ).length;
}

async function deleteArtifactGenerationJobs(
  context: AnonymousLifecycleDeletionContext,
): Promise<number> {
  if (context.platformArtifactIds.length === 0) return 0;
  return (
    await context.transaction
      .delete(artifactGenerationJobs)
      .where(
        inArray(artifactGenerationJobs.artifactId, [
          ...context.platformArtifactIds,
        ]),
      )
      .returning({ id: artifactGenerationJobs.id })
  ).length;
}

async function deleteArtifactVersions(
  context: AnonymousLifecycleDeletionContext,
): Promise<number> {
  if (context.platformArtifactIds.length === 0) return 0;
  return (
    await context.transaction
      .delete(artifactVersions)
      .where(
        inArray(artifactVersions.artifactId, [...context.platformArtifactIds]),
      )
      .returning({ id: artifactVersions.id })
  ).length;
}

async function deletePlatformArtifacts(
  context: AnonymousLifecycleDeletionContext,
): Promise<number> {
  return (
    await context.transaction
      .delete(artifacts)
      .where(eq(artifacts.ownerSubjectId, context.subjectId))
      .returning({ id: artifacts.id })
  ).length;
}

async function deleteConversationMessages(
  context: AnonymousLifecycleDeletionContext,
): Promise<number> {
  if (context.conversationIds.length === 0) return 0;
  return (
    await context.transaction
      .delete(conversationMessages)
      .where(
        inArray(conversationMessages.conversationId, [
          ...context.conversationIds,
        ]),
      )
      .returning({ id: conversationMessages.id })
  ).length;
}

async function deleteAgentOperations(
  context: AnonymousLifecycleDeletionContext,
): Promise<number> {
  if (context.conversationIds.length === 0) return 0;
  return (
    await context.transaction
      .delete(agentOperations)
      .where(
        inArray(agentOperations.conversationId, [...context.conversationIds]),
      )
      .returning({ id: agentOperations.id })
  ).length;
}

async function deleteConversations(
  context: AnonymousLifecycleDeletionContext,
): Promise<number> {
  return (
    await context.transaction
      .delete(conversations)
      .where(eq(conversations.ownerSubjectId, context.subjectId))
      .returning({ id: conversations.id })
  ).length;
}

async function deleteSpaces(
  context: AnonymousLifecycleDeletionContext,
): Promise<number> {
  return (
    await context.transaction
      .delete(spaces)
      .where(eq(spaces.ownerSubjectId, context.subjectId))
      .returning({ id: spaces.id })
  ).length;
}

async function deleteToolCalls(
  context: AnonymousLifecycleDeletionContext,
): Promise<number> {
  return (
    await context.transaction
      .delete(toolCalls)
      .where(inArray(toolCalls.sessionId, [...context.sessionIds]))
      .returning({ id: toolCalls.id })
  ).length;
}

async function deleteMessageCitations(
  context: AnonymousLifecycleDeletionContext,
): Promise<number> {
  return (
    await context.transaction
      .delete(messageCitations)
      .where(inArray(messageCitations.sessionId, [...context.sessionIds]))
      .returning({ id: messageCitations.id })
  ).length;
}

async function deleteModelRuns(
  context: AnonymousLifecycleDeletionContext,
): Promise<number> {
  return (
    await context.transaction
      .delete(modelRuns)
      .where(inArray(modelRuns.sessionId, [...context.sessionIds]))
      .returning({ id: modelRuns.id })
  ).length;
}

async function deleteSafetyDecisions(
  context: AnonymousLifecycleDeletionContext,
): Promise<number> {
  return (
    await context.transaction
      .delete(turnSafetyDecisions)
      .where(inArray(turnSafetyDecisions.sessionId, [...context.sessionIds]))
      .returning({ turnId: turnSafetyDecisions.turnId })
  ).length;
}

async function deleteGradingKeys(
  context: AnonymousLifecycleDeletionContext,
): Promise<number> {
  if (context.artifactRecordIds.length === 0) return 0;
  return (
    await context.transaction
      .delete(canvasArtifactGradingKeys)
      .where(
        inArray(canvasArtifactGradingKeys.artifactRecordId, [
          ...context.artifactRecordIds,
        ]),
      )
      .returning({ id: canvasArtifactGradingKeys.artifactRecordId })
  ).length;
}

async function deleteArtifacts(
  context: AnonymousLifecycleDeletionContext,
): Promise<number> {
  return (
    await context.transaction
      .delete(canvasArtifacts)
      .where(inArray(canvasArtifacts.sessionId, [...context.sessionIds]))
      .returning({ id: canvasArtifacts.id })
  ).length;
}

async function deleteRetrievalCandidates(
  context: AnonymousLifecycleDeletionContext,
): Promise<number> {
  return (
    await context.transaction
      .delete(retrievalCandidates)
      .where(inArray(retrievalCandidates.sessionId, [...context.sessionIds]))
      .returning({ id: retrievalCandidates.id })
  ).length;
}

async function deleteTurnSourceVersions(
  context: AnonymousLifecycleDeletionContext,
): Promise<number> {
  return (
    await context.transaction
      .delete(turnSourceVersions)
      .where(inArray(turnSourceVersions.sessionId, [...context.sessionIds]))
      .returning({ id: turnSourceVersions.id })
  ).length;
}

async function deleteTurnSourceSnapshots(
  context: AnonymousLifecycleDeletionContext,
): Promise<number> {
  return (
    await context.transaction
      .delete(turnSourceSnapshots)
      .where(inArray(turnSourceSnapshots.sessionId, [...context.sessionIds]))
      .returning({ id: turnSourceSnapshots.id })
  ).length;
}

async function deleteSessionSourceBindings(
  context: AnonymousLifecycleDeletionContext,
): Promise<number> {
  return (
    await context.transaction
      .delete(sessionSourceBindings)
      .where(inArray(sessionSourceBindings.sessionId, [...context.sessionIds]))
      .returning({ id: sessionSourceBindings.id })
  ).length;
}

async function deleteChatMessages(
  context: AnonymousLifecycleDeletionContext,
): Promise<number> {
  return (
    await context.transaction
      .delete(chatMessages)
      .where(inArray(chatMessages.sessionId, [...context.sessionIds]))
      .returning({ id: chatMessages.id })
  ).length;
}

async function deleteAgentMessageParts(
  context: AnonymousLifecycleDeletionContext,
): Promise<number> {
  const messages = await context.transaction
    .select({ id: chatMessages.id })
    .from(chatMessages)
    .where(inArray(chatMessages.sessionId, [...context.sessionIds]));
  if (messages.length === 0) return 0;
  return (
    await context.transaction
      .delete(agentMessageParts)
      .where(
        inArray(
          agentMessageParts.messageId,
          messages.map((message) => message.id),
        ),
      )
      .returning({ messageId: agentMessageParts.messageId })
  ).length;
}

async function deleteAssetVersions(
  context: AnonymousLifecycleDeletionContext,
): Promise<number> {
  const ownedAssets = await context.transaction
    .select({ id: assets.id })
    .from(assets)
    .where(eq(assets.ownerSubjectId, context.subjectId));
  if (ownedAssets.length === 0) return 0;
  // ready资产通过current_version_id形成受约束的回指。先在同一事务内进入
  // tombstoned形态并解除回指，随后才能显式删除不可变版本并保留逐表计数。
  await context.transaction
    .update(assets)
    .set({
      status: 'tombstoned',
      currentVersionId: null,
      tombstonedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(assets.ownerSubjectId, context.subjectId));
  return (
    await context.transaction
      .delete(assetVersions)
      .where(
        inArray(
          assetVersions.assetId,
          ownedAssets.map((asset) => asset.id),
        ),
      )
      .returning({ id: assetVersions.id })
  ).length;
}

async function deleteAssets(
  context: AnonymousLifecycleDeletionContext,
): Promise<number> {
  return (
    await context.transaction
      .delete(assets)
      .where(eq(assets.ownerSubjectId, context.subjectId))
      .returning({ id: assets.id })
  ).length;
}

async function deleteLearningEvents(
  context: AnonymousLifecycleDeletionContext,
): Promise<number> {
  return (
    await context.transaction
      .delete(learningEvents)
      .where(inArray(learningEvents.sessionId, [...context.sessionIds]))
      .returning({ id: learningEvents.id })
  ).length;
}

async function deleteLessonSessions(
  context: AnonymousLifecycleDeletionContext,
): Promise<number> {
  return (
    await context.transaction
      .delete(lessonSessions)
      .where(inArray(lessonSessions.id, [...context.sessionIds]))
      .returning({ id: lessonSessions.id })
  ).length;
}

async function deleteMasteryStates(
  context: AnonymousLifecycleDeletionContext,
): Promise<number> {
  return (
    await context.transaction
      .delete(masteryStates)
      .where(eq(masteryStates.studentId, context.subjectId))
      .returning({ studentId: masteryStates.studentId })
  ).length;
}

/**
 * 中央删除闭包。顺序就是事务中的真实执行顺序，新增任何subject/session/turn/artifact关联表时
 * 必须在同一PR扩展此处与coverage测试，不能只依赖偶然的ON DELETE CASCADE。
 */
const lifecycleDefinitions = [
  {
    tableName: 'conversation_message_citations',
    ownershipPath: 'message_id -> conversation_messages.conversation_id',
    deleteRows: deleteConversationMessageCitations,
  },
  {
    tableName: 'operation_sources',
    ownershipPath: 'operation_id -> agent_operations.conversation_id',
    deleteRows: deleteOperationSources,
  },
  {
    tableName: 'artifact_generation_jobs',
    ownershipPath: 'artifact_id -> artifacts.owner_subject_id',
    deleteRows: deleteArtifactGenerationJobs,
  },
  {
    tableName: 'artifact_versions',
    ownershipPath: 'artifact_id -> artifacts.owner_subject_id',
    deleteRows: deleteArtifactVersions,
  },
  {
    tableName: 'artifacts',
    ownershipPath: 'owner_subject_id',
    deleteRows: deletePlatformArtifacts,
  },
  {
    tableName: 'conversation_messages',
    ownershipPath: 'conversation_id -> conversations.owner_subject_id',
    deleteRows: deleteConversationMessages,
  },
  {
    tableName: 'agent_operations',
    ownershipPath: 'conversation_id -> conversations.owner_subject_id',
    deleteRows: deleteAgentOperations,
  },
  {
    tableName: 'conversations',
    ownershipPath: 'owner_subject_id',
    deleteRows: deleteConversations,
  },
  {
    tableName: 'spaces',
    ownershipPath: 'owner_subject_id',
    deleteRows: deleteSpaces,
  },
  {
    tableName: 'message_citations',
    ownershipPath: 'session_id',
    deleteRows: deleteMessageCitations,
  },
  {
    tableName: 'tool_calls',
    ownershipPath: 'session_id',
    deleteRows: deleteToolCalls,
  },
  {
    tableName: 'model_runs',
    ownershipPath: 'session_id',
    deleteRows: deleteModelRuns,
  },
  {
    tableName: 'turn_safety_decisions',
    ownershipPath: 'session_id',
    deleteRows: deleteSafetyDecisions,
  },
  {
    tableName: 'canvas_artifact_grading_keys',
    ownershipPath: 'artifact_record_id -> canvas_artifacts.session_id',
    deleteRows: deleteGradingKeys,
  },
  {
    tableName: 'canvas_artifacts',
    ownershipPath: 'session_id',
    deleteRows: deleteArtifacts,
  },
  {
    tableName: 'retrieval_candidates',
    ownershipPath: 'session_id',
    deleteRows: deleteRetrievalCandidates,
  },
  {
    tableName: 'turn_source_versions',
    ownershipPath: 'session_id',
    deleteRows: deleteTurnSourceVersions,
  },
  {
    tableName: 'turn_source_snapshots',
    ownershipPath: 'session_id',
    deleteRows: deleteTurnSourceSnapshots,
  },
  {
    tableName: 'session_source_bindings',
    ownershipPath: 'session_id',
    deleteRows: deleteSessionSourceBindings,
  },
  {
    tableName: 'agent_message_parts',
    ownershipPath: 'message_id -> chat_messages.session_id',
    deleteRows: deleteAgentMessageParts,
  },
  {
    tableName: 'chat_messages',
    ownershipPath: 'session_id',
    deleteRows: deleteChatMessages,
  },
  {
    tableName: 'learning_events',
    ownershipPath: 'session_id',
    deleteRows: deleteLearningEvents,
  },
  {
    tableName: 'asset_versions',
    ownershipPath: 'asset_id -> assets.owner_subject_id',
    deleteRows: deleteAssetVersions,
  },
  {
    tableName: 'assets',
    ownershipPath: 'owner_subject_id',
    deleteRows: deleteAssets,
  },
  {
    tableName: 'lesson_sessions',
    ownershipPath: 'student_id',
    deleteRows: deleteLessonSessions,
  },
  {
    tableName: 'mastery_states',
    ownershipPath: 'student_id',
    deleteRows: deleteMasteryStates,
  },
] as const satisfies readonly AnonymousLifecycleDefinition[];

export type AnonymousDataLifecycleTableName =
  (typeof lifecycleDefinitions)[number]['tableName'];

export interface AnonymousDataLifecycleRegistryEntry {
  tableName: AnonymousDataLifecycleTableName;
  ownershipPath: AnonymousDataOwnershipPath;
  deletionOrder: number;
}

export const ANONYMOUS_DATA_LIFECYCLE_REGISTRY = Object.freeze(
  lifecycleDefinitions.map(
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
        for (const definition of lifecycleDefinitions) {
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
