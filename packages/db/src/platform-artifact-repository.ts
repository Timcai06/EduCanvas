import { and, desc, eq, sql } from 'drizzle-orm';
import { getDb } from './client';
import {
  artifactGenerationJobs,
  artifactVersions,
  artifacts,
  spaces,
} from './schema';

type Database = ReturnType<typeof getDb>;

/** 主体不拥有目标 Space/Artifact 时抛出;与查无此物同错,避免所有权探测。 */
export class ArtifactOwnershipError extends Error {
  readonly code = 'artifact_ownership';

  constructor() {
    super('产物不存在或不属于当前主体');
    this.name = 'ArtifactOwnershipError';
  }
}

/** 版本号并发冲突(同一产物同一版本被同时写入)。 */
export class ArtifactVersionConflictError extends Error {
  readonly code = 'artifact_version_conflict';

  constructor() {
    super('产物版本写入冲突,请重试');
    this.name = 'ArtifactVersionConflictError';
  }
}

/** 生成任务状态机拒绝非法转移。 */
export class ArtifactJobLifecycleError extends Error {
  readonly code = 'artifact_job_lifecycle';

  constructor(from: string, to: string) {
    super(`生成任务不允许从 ${from} 转移到 ${to}`);
    this.name = 'ArtifactJobLifecycleError';
  }
}

export type ArtifactTrustTier = 'tier1' | 'tier2';
export type ArtifactStatus = 'proposed' | 'active' | 'archived';
export type ArtifactJobStatus =
  'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface PlatformArtifact {
  id: string;
  spaceId: string;
  conversationId: string | null;
  ownerSubjectId: string;
  kind: string;
  trustTier: ArtifactTrustTier;
  title: string;
  status: ArtifactStatus;
  latestVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface PlatformArtifactVersion {
  id: string;
  artifactId: string;
  version: number;
  content: unknown;
  objectKey: string | null;
  checksum: string | null;
  createdAt: string;
}

export interface PlatformArtifactJob {
  id: string;
  artifactId: string;
  status: ArtifactJobStatus;
  progress: number | null;
  failureCode: string | null;
  queueJobKey: string | null;
}

/** 生成任务合法转移表;terminal 态无出边,cancelled 可从任何非 terminal 态进入。 */
const JOB_TRANSITIONS: Record<ArtifactJobStatus, readonly ArtifactJobStatus[]> =
  {
    queued: ['running', 'cancelled'],
    running: ['succeeded', 'failed', 'cancelled'],
    succeeded: [],
    failed: [],
    cancelled: [],
  };

const isUniqueViolation = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  (error as { code?: string }).code === '23505';

/**
 * 平台 Artifact 一等公民仓储(ADR-0012)。调用边界:
 * - 所有读写都要求可信主体(trustedSubjectId),所有权不匹配一律 ArtifactOwnershipError;
 * - 版本不可变:只提供 append,写入在事务内锁产物行并单调递增 latestVersion;
 * - trust tier 只在创建时确定,之后不可修改——层级迁移必须新建产物(ADR-0010 升级通道)。
 * 与 K12 `canvas_artifacts`(题面/判分键)无关,后者仍由 artifact-repository.ts 服务。
 */
export class DrizzlePlatformArtifactRepository {
  constructor(private readonly providedDatabase?: Database) {}

  private get database(): Database {
    return this.providedDatabase ?? getDb();
  }

  async createArtifact(input: {
    spaceId: string;
    conversationId?: string | null;
    trustedSubjectId: string;
    kind: string;
    trustTier: ArtifactTrustTier;
    title: string;
    status?: Extract<ArtifactStatus, 'proposed' | 'active'>;
  }): Promise<PlatformArtifact> {
    const [space] = await this.database
      .select({ ownerSubjectId: spaces.ownerSubjectId })
      .from(spaces)
      .where(eq(spaces.id, input.spaceId))
      .limit(1);
    if (!space || space.ownerSubjectId !== input.trustedSubjectId) {
      throw new ArtifactOwnershipError();
    }

    const [row] = await this.database
      .insert(artifacts)
      .values({
        spaceId: input.spaceId,
        conversationId: input.conversationId ?? null,
        ownerSubjectId: input.trustedSubjectId,
        kind: input.kind,
        trustTier: input.trustTier,
        title: input.title,
        status: input.status ?? 'proposed',
      })
      .returning();
    return toArtifact(row!);
  }

  async getArtifact(input: {
    artifactId: string;
    trustedSubjectId: string;
  }): Promise<PlatformArtifact> {
    const [row] = await this.database
      .select()
      .from(artifacts)
      .where(
        and(
          eq(artifacts.id, input.artifactId),
          eq(artifacts.ownerSubjectId, input.trustedSubjectId),
        ),
      )
      .limit(1);
    if (!row) throw new ArtifactOwnershipError();
    return toArtifact(row);
  }

  async listConversationArtifacts(input: {
    conversationId: string;
    trustedSubjectId: string;
    limit?: number;
  }): Promise<readonly PlatformArtifact[]> {
    const rows = await this.database
      .select()
      .from(artifacts)
      .where(
        and(
          eq(artifacts.conversationId, input.conversationId),
          eq(artifacts.ownerSubjectId, input.trustedSubjectId),
        ),
      )
      .orderBy(desc(artifacts.updatedAt), desc(artifacts.id))
      .limit(Math.min(input.limit ?? 50, 100));
    return rows.map(toArtifact);
  }

  /**
   * 追加不可变版本。事务内 `for update` 锁产物行保证版本单调;
   * 结构化内容与对象存储引用二选一由数据库形状约束兜底。
   */
  async appendVersion(input: {
    artifactId: string;
    trustedSubjectId: string;
    content?: unknown;
    objectKey?: string;
    checksum?: string;
    createdByOperationId?: string | null;
    generationJobId?: string | null;
  }): Promise<PlatformArtifactVersion> {
    try {
      return await this.database.transaction(async (tx) => {
        const [artifact] = await tx
          .select({
            id: artifacts.id,
            ownerSubjectId: artifacts.ownerSubjectId,
            latestVersion: artifacts.latestVersion,
          })
          .from(artifacts)
          .where(eq(artifacts.id, input.artifactId))
          .for('update')
          .limit(1);
        if (!artifact || artifact.ownerSubjectId !== input.trustedSubjectId) {
          throw new ArtifactOwnershipError();
        }

        const nextVersion = artifact.latestVersion + 1;
        const [version] = await tx
          .insert(artifactVersions)
          .values({
            artifactId: input.artifactId,
            version: nextVersion,
            content: input.content ?? null,
            objectKey: input.objectKey ?? null,
            checksum: input.checksum ?? null,
            createdByOperationId: input.createdByOperationId ?? null,
            generationJobId: input.generationJobId ?? null,
          })
          .returning();
        await tx
          .update(artifacts)
          .set({
            latestVersion: nextVersion,
            status: 'active',
            updatedAt: sql`now()`,
          })
          .where(eq(artifacts.id, input.artifactId));
        return toVersion(version!);
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new ArtifactVersionConflictError();
      throw error;
    }
  }

  async listVersions(input: {
    artifactId: string;
    trustedSubjectId: string;
  }): Promise<readonly PlatformArtifactVersion[]> {
    await this.getArtifact(input);
    const rows = await this.database
      .select()
      .from(artifactVersions)
      .where(eq(artifactVersions.artifactId, input.artifactId))
      .orderBy(desc(artifactVersions.version));
    return rows.map(toVersion);
  }

  async createGenerationJob(input: {
    artifactId: string;
    trustedSubjectId: string;
    operationId?: string | null;
    params?: Record<string, unknown>;
    queueJobKey?: string | null;
  }): Promise<PlatformArtifactJob> {
    await this.getArtifact(input);
    const [row] = await this.database
      .insert(artifactGenerationJobs)
      .values({
        artifactId: input.artifactId,
        operationId: input.operationId ?? null,
        params: input.params ?? {},
        queueJobKey: input.queueJobKey ?? null,
      })
      .returning();
    return toJob(row!);
  }

  /**
   * 生成任务状态转移。合法性先由内存转移表裁决,时间戳形状由数据库约束兜底;
   * failed 必须携带 failureCode。
   */
  async transitionGenerationJob(input: {
    jobId: string;
    trustedSubjectId: string;
    to: Exclude<ArtifactJobStatus, 'queued'>;
    progress?: number | null;
    failureCode?: string | null;
  }): Promise<PlatformArtifactJob> {
    return await this.database.transaction(async (tx) => {
      const [row] = await tx
        .select({
          id: artifactGenerationJobs.id,
          status: artifactGenerationJobs.status,
          startedAt: artifactGenerationJobs.startedAt,
          owner: artifacts.ownerSubjectId,
        })
        .from(artifactGenerationJobs)
        .innerJoin(
          artifacts,
          eq(artifactGenerationJobs.artifactId, artifacts.id),
        )
        .where(eq(artifactGenerationJobs.id, input.jobId))
        .for('update', { of: artifactGenerationJobs })
        .limit(1);
      if (!row || row.owner !== input.trustedSubjectId) {
        throw new ArtifactOwnershipError();
      }

      const from = row.status as ArtifactJobStatus;
      if (!JOB_TRANSITIONS[from].includes(input.to)) {
        throw new ArtifactJobLifecycleError(from, input.to);
      }

      const isTerminal = input.to !== 'running';
      const [updated] = await tx
        .update(artifactGenerationJobs)
        .set({
          status: input.to,
          progress: input.progress ?? null,
          failureCode:
            input.to === 'failed' ? (input.failureCode ?? null) : null,
          startedAt:
            input.to === 'running' ? sql`now()` : (row.startedAt ?? null),
          completedAt: isTerminal ? sql`now()` : null,
        })
        .where(eq(artifactGenerationJobs.id, input.jobId))
        .returning();
      return toJob(updated!);
    });
  }
}

type ArtifactRow = typeof artifacts.$inferSelect;
type VersionRow = typeof artifactVersions.$inferSelect;
type JobRow = typeof artifactGenerationJobs.$inferSelect;

const toArtifact = (row: ArtifactRow): PlatformArtifact => ({
  id: row.id,
  spaceId: row.spaceId,
  conversationId: row.conversationId,
  ownerSubjectId: row.ownerSubjectId,
  kind: row.kind,
  trustTier: row.trustTier as ArtifactTrustTier,
  title: row.title,
  status: row.status as ArtifactStatus,
  latestVersion: row.latestVersion,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

const toVersion = (row: VersionRow): PlatformArtifactVersion => ({
  id: row.id,
  artifactId: row.artifactId,
  version: row.version,
  content: row.content,
  objectKey: row.objectKey,
  checksum: row.checksum,
  createdAt: row.createdAt.toISOString(),
});

const toJob = (row: JobRow): PlatformArtifactJob => ({
  id: row.id,
  artifactId: row.artifactId,
  status: row.status as ArtifactJobStatus,
  progress: row.progress,
  failureCode: row.failureCode,
  queueJobKey: row.queueJobKey,
});
