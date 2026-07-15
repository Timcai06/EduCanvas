import {
  artifactGradingKeySchema,
  prepareArtifact,
  type ArtifactGradingKey,
} from '@educanvas/canvas-protocol/server';
import {
  publicArtifactSchema,
  type PublicArtifact,
} from '@educanvas/canvas-protocol';
import { selectInitialState } from '@educanvas/teaching-core';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { isDeepStrictEqual } from 'node:util';
import { getDb } from './client';
import {
  canvasArtifactGradingKeys,
  canvasArtifacts,
  lessonSessions,
  masteryStates,
} from './schema';

type Database = ReturnType<typeof getDb>;
type DatabaseTransaction = Parameters<
  Parameters<Database['transaction']>[0]
>[0];

/** 匿名演示会话的服务端有效期；Cookie过期不能替代数据库侧的重放限制。 */
export const ANONYMOUS_LEARNING_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1_000;

function activeSessionCutoff(): Date {
  return new Date(Date.now() - ANONYMOUS_LEARNING_SESSION_TTL_MS);
}

/** 阶段一课程纵切的稳定范围；匿名身份只能在此范围内恢复自己的当前会话。 */
export interface LearningSessionScope {
  studentId: string;
  gradeBand: string;
  courseSlug: string;
  knowledgeNodeId: string;
}

export interface BootstrapLearningSessionInput extends LearningSessionScope {
  completeArtifact: unknown;
}

export interface BootstrappedLearningSession {
  sessionId: string;
  studentId: string;
  knowledgeNodeId: string;
  artifact: PublicArtifact;
}

export interface OwnedLearningSession {
  sessionId: string;
  studentId: string;
  knowledgeNodeId: string;
}

export interface LearningPageSnapshot extends OwnedLearningSession {
  artifact: PublicArtifact;
  mastery: {
    masteryScore: number;
    attemptCount: number;
    correctCount: number;
    hintCount: number;
    nextReviewAt: string | null;
  } | null;
}

/** 同一Artifact ID出现不同公开内容或判分键时拒绝静默覆盖。 */
export class ArtifactContentConflictError extends Error {
  constructor(artifactId: string) {
    super(`Canvas Artifact ${artifactId}已存在但内容不一致`);
    this.name = 'ArtifactContentConflictError';
  }
}

function toJsonValue<T>(value: T): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown;
}

async function ensurePreparedArtifact(
  transaction: DatabaseTransaction,
  sessionId: string,
  prepared: {
    publicArtifact: PublicArtifact;
    gradingKey: ArtifactGradingKey;
  },
): Promise<void> {
  const [existing] = await transaction
    .select({
      publicArtifact: {
        schemaVersion: canvasArtifacts.schemaVersion,
        artifactId: canvasArtifacts.artifactId,
        type: canvasArtifacts.type,
        title: canvasArtifacts.title,
        params: canvasArtifacts.params,
      },
      gradingKey: canvasArtifactGradingKeys.gradingKey,
    })
    .from(canvasArtifacts)
    .leftJoin(
      canvasArtifactGradingKeys,
      eq(canvasArtifactGradingKeys.artifactRecordId, canvasArtifacts.id),
    )
    .where(
      and(
        eq(canvasArtifacts.sessionId, sessionId),
        eq(canvasArtifacts.artifactId, prepared.publicArtifact.artifactId),
      ),
    )
    .limit(1);

  if (existing) {
    if (existing.gradingKey === null) {
      throw new ArtifactContentConflictError(
        prepared.publicArtifact.artifactId,
      );
    }
    const publicArtifact = publicArtifactSchema.parse(existing.publicArtifact);
    const gradingKey = artifactGradingKeySchema.parse(existing.gradingKey);
    if (
      !isDeepStrictEqual(
        toJsonValue(publicArtifact),
        toJsonValue(prepared.publicArtifact),
      ) ||
      !isDeepStrictEqual(
        toJsonValue(gradingKey),
        toJsonValue(prepared.gradingKey),
      )
    ) {
      throw new ArtifactContentConflictError(
        prepared.publicArtifact.artifactId,
      );
    }
    return;
  }

  const [artifactRow] = await transaction
    .insert(canvasArtifacts)
    .values({
      sessionId,
      artifactId: prepared.publicArtifact.artifactId,
      type: prepared.publicArtifact.type,
      schemaVersion: prepared.publicArtifact.schemaVersion,
      title: prepared.publicArtifact.title,
      params: prepared.publicArtifact.params,
    })
    .returning({ id: canvasArtifacts.id });
  if (!artifactRow) throw new Error('Canvas Artifact写入失败');

  await transaction.insert(canvasArtifactGradingKeys).values({
    artifactRecordId: artifactRow.id,
    gradingKey: prepared.gradingKey,
  });
}

/**
 * 匿名学习纵切仓储。bootstrap通过事务级advisory lock保证同一学生和课程并发请求只创建一个会话，
 * 并把Session、公开Artifact与私有判分键作为一个原子提交。
 */
export class DrizzleLearningSessionRepository {
  constructor(private readonly providedDatabase?: Database) {}

  private get database(): Database {
    return this.providedDatabase ?? getDb();
  }

  async bootstrap(
    input: BootstrapLearningSessionInput,
  ): Promise<BootstrappedLearningSession> {
    const prepared = prepareArtifact(input.completeArtifact);
    const lockKey = [
      'lesson-bootstrap-v1',
      input.studentId,
      input.gradeBand,
      input.courseSlug,
      input.knowledgeNodeId,
    ].join(':');

    return this.database.transaction(async (transaction) => {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`,
      );
      const [existingSession] = await transaction
        .select({ id: lessonSessions.id })
        .from(lessonSessions)
        .where(
          and(
            eq(lessonSessions.studentId, input.studentId),
            eq(lessonSessions.gradeBand, input.gradeBand),
            eq(lessonSessions.courseSlug, input.courseSlug),
            eq(lessonSessions.knowledgeNodeId, input.knowledgeNodeId),
            gte(lessonSessions.createdAt, activeSessionCutoff()),
          ),
        )
        .orderBy(desc(lessonSessions.createdAt), desc(lessonSessions.id))
        .limit(1);

      let sessionId = existingSession?.id;
      if (!sessionId) {
        const [existingMastery] = await transaction
          .select({ studentId: masteryStates.studentId })
          .from(masteryStates)
          .where(
            and(
              eq(masteryStates.studentId, input.studentId),
              eq(masteryStates.knowledgeNodeId, input.knowledgeNodeId),
            ),
          )
          .limit(1);
        const [created] = await transaction
          .insert(lessonSessions)
          .values({
            studentId: input.studentId,
            gradeBand: input.gradeBand,
            courseSlug: input.courseSlug,
            knowledgeNodeId: input.knowledgeNodeId,
            state: selectInitialState(Boolean(existingMastery)),
          })
          .returning({ id: lessonSessions.id });
        if (!created) throw new Error('学习会话写入失败');
        sessionId = created.id;
      }

      await ensurePreparedArtifact(transaction, sessionId, prepared);
      return {
        sessionId,
        studentId: input.studentId,
        knowledgeNodeId: input.knowledgeNodeId,
        artifact: prepared.publicArtifact,
      };
    });
  }

  async getCurrentOwned(
    scope: LearningSessionScope,
  ): Promise<OwnedLearningSession | null> {
    const [row] = await this.database
      .select({
        sessionId: lessonSessions.id,
        studentId: lessonSessions.studentId,
        knowledgeNodeId: lessonSessions.knowledgeNodeId,
      })
      .from(lessonSessions)
      .where(
        and(
          eq(lessonSessions.studentId, scope.studentId),
          eq(lessonSessions.gradeBand, scope.gradeBand),
          eq(lessonSessions.courseSlug, scope.courseSlug),
          eq(lessonSessions.knowledgeNodeId, scope.knowledgeNodeId),
          gte(lessonSessions.createdAt, activeSessionCutoff()),
        ),
      )
      .orderBy(desc(lessonSessions.createdAt), desc(lessonSessions.id))
      .limit(1);
    if (!row || !row.knowledgeNodeId) return null;
    return { ...row, knowledgeNodeId: row.knowledgeNodeId };
  }

  async getPageSnapshot(
    scope: LearningSessionScope,
    artifactId: string,
  ): Promise<LearningPageSnapshot | null> {
    const session = await this.getCurrentOwned(scope);
    if (!session) return null;

    const [artifactRow] = await this.database
      .select()
      .from(canvasArtifacts)
      .where(
        and(
          eq(canvasArtifacts.sessionId, session.sessionId),
          eq(canvasArtifacts.artifactId, artifactId),
        ),
      )
      .limit(1);
    if (!artifactRow) return null;

    const [masteryRow] = await this.database
      .select()
      .from(masteryStates)
      .where(
        and(
          eq(masteryStates.studentId, scope.studentId),
          eq(masteryStates.knowledgeNodeId, scope.knowledgeNodeId),
        ),
      )
      .limit(1);

    return {
      ...session,
      artifact: publicArtifactSchema.parse({
        schemaVersion: artifactRow.schemaVersion,
        artifactId: artifactRow.artifactId,
        type: artifactRow.type,
        title: artifactRow.title,
        params: artifactRow.params,
      }),
      mastery: masteryRow
        ? {
            masteryScore: masteryRow.masteryScore,
            attemptCount: masteryRow.attemptCount,
            correctCount: masteryRow.correctCount,
            hintCount: masteryRow.hintCount,
            nextReviewAt: masteryRow.nextReviewAt?.toISOString() ?? null,
          }
        : null,
    };
  }
}
