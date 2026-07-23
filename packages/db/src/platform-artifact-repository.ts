import { and, desc, eq, inArray, sql } from 'drizzle-orm';
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

/** Canvas 修改基于过期版本或目标已有运行中任务时拒绝，防止覆盖更新。 */
export class ArtifactRevisionConflictError extends Error {
  readonly code = 'artifact_revision_conflict';

  constructor(readonly reason: 'stale_version' | 'job_in_progress') {
    super(
      reason === 'stale_version'
        ? '产物已经产生新版本，请刷新后再修改'
        : '产物仍有修改任务在运行',
    );
    this.name = 'ArtifactRevisionConflictError';
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

/** 产物生成任务在 graphile 队列中的标识;web 入队与 worker 注册共用,防止拼写漂移。 */
export const ARTIFACT_GENERATE_TASK = 'artifact:generate' as const;

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
  metadata: unknown;
  objectKey: string | null;
  checksum: string | null;
  generatedBy: string | null;
  createdAt: string;
}

export interface PlatformArtifactJob {
  id: string;
  artifactId: string;
  status: ArtifactJobStatus;
  progress: number | null;
  failureCode: string | null;
  params: Record<string, unknown>;
  checkpoint: Record<string, unknown>;
  queueJobKey: string | null;
}

/** 生成任务合法转移表;terminal 态无出边,cancelled 可从任何非 terminal 态进入。 */
const JOB_TRANSITIONS: Record<ArtifactJobStatus, readonly ArtifactJobStatus[]> =
  {
    queued: ['running', 'cancelled'],
    running: ['running', 'succeeded', 'failed', 'cancelled'],
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

  /** Notebook/Space 是 Studio 的聚合根；Conversation 只记录产物产生时的聊天上下文。 */
  async listSpaceArtifacts(input: {
    spaceId: string;
    trustedSubjectId: string;
    limit?: number;
  }): Promise<readonly PlatformArtifact[]> {
    const rows = await this.database
      .select()
      .from(artifacts)
      .where(
        and(
          eq(artifacts.spaceId, input.spaceId),
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
    metadata?: Record<string, unknown> | null;
    objectKey?: string;
    checksum?: string;
    generatedBy?: string | null;
    createdByOperationId?: string | null;
    generationJobId?: string | null;
    /** Canvas 共创的乐观并发基线；首版生成不传。 */
    expectedLatestVersion?: number;
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
        if (
          input.expectedLatestVersion !== undefined &&
          artifact.latestVersion !== input.expectedLatestVersion
        ) {
          throw new ArtifactRevisionConflictError('stale_version');
        }

        const nextVersion = artifact.latestVersion + 1;
        const [version] = await tx
          .insert(artifactVersions)
          .values({
            artifactId: input.artifactId,
            version: nextVersion,
            content: input.content ?? null,
            metadata: input.metadata ?? null,
            objectKey: input.objectKey ?? null,
            checksum: input.checksum ?? null,
            generatedBy: input.generatedBy ?? null,
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

  /**
   * 版本溯源清单：每版怎么来的。用生成任务 params 里的 revision.instruction
   * 还原"你当时的修改要求"，供 Canvas 版本历史讲清初始生成 vs 逐轮共创。
   * 只投影用户自己写下的指令与生成器标识，不含判分键或模型内部账本。
   */
  async listVersionProvenance(input: {
    artifactId: string;
    trustedSubjectId: string;
  }): Promise<
    readonly {
      version: number;
      generatedBy: string | null;
      revisionInstruction: string | null;
      createdAt: string;
    }[]
  > {
    await this.getArtifact(input);
    const rows = await this.database
      .select({
        version: artifactVersions.version,
        generatedBy: artifactVersions.generatedBy,
        createdAt: artifactVersions.createdAt,
        instruction: sql<
          string | null
        >`${artifactGenerationJobs.params} #>> '{revision,instruction}'`,
      })
      .from(artifactVersions)
      .leftJoin(
        artifactGenerationJobs,
        eq(artifactVersions.generationJobId, artifactGenerationJobs.id),
      )
      .where(eq(artifactVersions.artifactId, input.artifactId))
      .orderBy(desc(artifactVersions.version));
    return rows.map((row) => ({
      version: row.version,
      generatedBy: row.generatedBy,
      revisionInstruction: row.instruction,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async getVersion(input: {
    artifactId: string;
    version: number;
    trustedSubjectId: string;
  }): Promise<PlatformArtifactVersion> {
    await this.getArtifact(input);
    const [row] = await this.database
      .select()
      .from(artifactVersions)
      .where(
        and(
          eq(artifactVersions.artifactId, input.artifactId),
          eq(artifactVersions.version, input.version),
        ),
      )
      .limit(1);
    if (!row) throw new ArtifactOwnershipError();
    return toVersion(row);
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
            input.to === 'running'
              ? (row.startedAt ?? sql`now()`)
              : (row.startedAt ?? null),
          completedAt: isTerminal ? sql`now()` : null,
        })
        .where(eq(artifactGenerationJobs.id, input.jobId))
        .returning();
      return toJob(updated!);
    });
  }

  /** 队列重投时按 jobId 读取权威参数与 checkpoint，并再次校验主体。 */
  async getGenerationJob(input: {
    jobId: string;
    trustedSubjectId: string;
  }): Promise<PlatformArtifactJob> {
    const [row] = await this.database
      .select({ job: artifactGenerationJobs })
      .from(artifactGenerationJobs)
      .innerJoin(artifacts, eq(artifactGenerationJobs.artifactId, artifacts.id))
      .where(
        and(
          eq(artifactGenerationJobs.id, input.jobId),
          eq(artifacts.ownerSubjectId, input.trustedSubjectId),
        ),
      )
      .limit(1);
    if (!row) throw new ArtifactOwnershipError();
    return toJob(row.job);
  }

  /**
   * 只允许 running 任务写入可恢复 checkpoint。音频先落对象存储、再写此记录，
   * 重投时可校验并继续 append version，而无需再次调用计费 Provider。
   */
  async updateGenerationJobCheckpoint(input: {
    jobId: string;
    trustedSubjectId: string;
    checkpoint: Record<string, unknown>;
  }): Promise<PlatformArtifactJob> {
    return await this.database.transaction(async (tx) => {
      const [row] = await tx
        .select({
          job: artifactGenerationJobs,
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
      if (row.job.status !== 'running') {
        throw new ArtifactJobLifecycleError(row.job.status, 'running');
      }
      const [updated] = await tx
        .update(artifactGenerationJobs)
        .set({ checkpoint: input.checkpoint })
        .where(eq(artifactGenerationJobs.id, input.jobId))
        .returning();
      return toJob(updated!);
    });
  }

  /** generationJobId 唯一对应一次版本提交；用于 crash 后识别“已写版本未终态”。 */
  async findVersionByGenerationJob(input: {
    jobId: string;
    trustedSubjectId: string;
  }): Promise<PlatformArtifactVersion | null> {
    await this.getGenerationJob(input);
    const [row] = await this.database
      .select()
      .from(artifactVersions)
      .where(eq(artifactVersions.generationJobId, input.jobId))
      .limit(1);
    return row ? toVersion(row) : null;
  }

  /**
   * 提议产物并原子入队生成任务(ADR-0012 的核心承诺):产物行、任务账本行与
   * graphile 队列行在同一事务提交,回滚则三者俱无。依赖 `graphile_worker`
   * schema 已由 worker 首次启动时自迁移建立;worker 从未启动过的环境会以
   * storage 异常诚实失败,不做静默降级。
   */
  async createArtifactWithGenerationJob(input: {
    spaceId: string;
    conversationId: string;
    trustedSubjectId: string;
    kind: string;
    trustTier: ArtifactTrustTier;
    title: string;
    taskIdentifier: string;
    params?: Record<string, unknown>;
    maxAttempts?: number;
  }): Promise<{ artifact: PlatformArtifact; job: PlatformArtifactJob }> {
    return await this.database.transaction(async (tx) => {
      const [space] = await tx
        .select({ ownerSubjectId: spaces.ownerSubjectId })
        .from(spaces)
        .where(eq(spaces.id, input.spaceId))
        .limit(1);
      if (!space || space.ownerSubjectId !== input.trustedSubjectId) {
        throw new ArtifactOwnershipError();
      }

      const [artifactRow] = await tx
        .insert(artifacts)
        .values({
          spaceId: input.spaceId,
          conversationId: input.conversationId,
          ownerSubjectId: input.trustedSubjectId,
          kind: input.kind,
          trustTier: input.trustTier,
          title: input.title,
          status: 'proposed',
        })
        .returning();
      const artifact = toArtifact(artifactRow!);

      const queueJobKey = `artifact-generate:${artifact.id}`;
      const [jobRow] = await tx
        .insert(artifactGenerationJobs)
        .values({
          artifactId: artifact.id,
          params: input.params ?? {},
          queueJobKey,
        })
        .returning();
      const job = toJob(jobRow!);

      const payload = JSON.stringify({
        jobId: job.id,
        artifactId: artifact.id,
        subjectId: input.trustedSubjectId,
      });
      await tx.execute(sql`
        select graphile_worker.add_job(
          ${input.taskIdentifier},
          payload := ${payload}::json,
          job_key := ${queueJobKey},
          max_attempts := ${input.maxAttempts ?? 3}
        )
      `);

      return { artifact, job };
    });
  }

  /**
   * 在同一 Artifact 上创建下一轮 Canvas 修改任务。锁定产物并校验基线版本，
   * 同一时刻只允许一个非终态任务；任务与队列行仍保持原子提交。
   */
  async createRevisionGenerationJob(input: {
    artifactId: string;
    conversationId: string;
    trustedSubjectId: string;
    baseVersion: number;
    instruction: string;
    taskIdentifier: string;
    maxAttempts?: number;
  }): Promise<{ artifact: PlatformArtifact; job: PlatformArtifactJob }> {
    return await this.database.transaction(async (tx) => {
      const [artifactRow] = await tx
        .select()
        .from(artifacts)
        .where(eq(artifacts.id, input.artifactId))
        .for('update')
        .limit(1);
      if (
        !artifactRow ||
        artifactRow.ownerSubjectId !== input.trustedSubjectId ||
        artifactRow.conversationId !== input.conversationId ||
        artifactRow.status !== 'active'
      ) {
        throw new ArtifactOwnershipError();
      }
      if (artifactRow.latestVersion !== input.baseVersion) {
        throw new ArtifactRevisionConflictError('stale_version');
      }

      const [activeJob] = await tx
        .select({ id: artifactGenerationJobs.id })
        .from(artifactGenerationJobs)
        .where(
          and(
            eq(artifactGenerationJobs.artifactId, input.artifactId),
            inArray(artifactGenerationJobs.status, ['queued', 'running']),
          ),
        )
        .limit(1);
      if (activeJob) {
        throw new ArtifactRevisionConflictError('job_in_progress');
      }

      const [insertedJob] = await tx
        .insert(artifactGenerationJobs)
        .values({
          artifactId: input.artifactId,
          params: {
            revision: {
              baseVersion: input.baseVersion,
              instruction: input.instruction,
            },
          },
        })
        .returning();
      const queueJobKey = `artifact-revise:${input.artifactId}:${insertedJob!.id}`;
      const [jobRow] = await tx
        .update(artifactGenerationJobs)
        .set({ queueJobKey })
        .where(eq(artifactGenerationJobs.id, insertedJob!.id))
        .returning();

      const payload = JSON.stringify({
        jobId: jobRow!.id,
        artifactId: input.artifactId,
        subjectId: input.trustedSubjectId,
      });
      await tx.execute(sql`
        select graphile_worker.add_job(
          ${input.taskIdentifier},
          payload := ${payload}::json,
          job_key := ${queueJobKey},
          max_attempts := ${input.maxAttempts ?? 3}
        )
      `);

      return { artifact: toArtifact(artifactRow), job: toJob(jobRow!) };
    });
  }

  /** 产物详情:最新版本内容与最近一次生成任务,供轮询与 Canvas 打开使用。 */
  async getArtifactDetail(input: {
    artifactId: string;
    trustedSubjectId: string;
  }): Promise<{
    artifact: PlatformArtifact;
    latestVersion: PlatformArtifactVersion | null;
    latestJob: PlatformArtifactJob | null;
  }> {
    const artifact = await this.getArtifact(input);
    const [versionRow] = await this.database
      .select()
      .from(artifactVersions)
      .where(eq(artifactVersions.artifactId, artifact.id))
      .orderBy(desc(artifactVersions.version))
      .limit(1);
    const [jobRow] = await this.database
      .select()
      .from(artifactGenerationJobs)
      .where(eq(artifactGenerationJobs.artifactId, artifact.id))
      .orderBy(desc(artifactGenerationJobs.createdAt))
      .limit(1);
    return {
      artifact,
      latestVersion: versionRow ? toVersion(versionRow) : null,
      latestJob: jobRow ? toJob(jobRow) : null,
    };
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
  metadata: row.metadata,
  objectKey: row.objectKey,
  checksum: row.checksum,
  generatedBy: row.generatedBy,
  createdAt: row.createdAt.toISOString(),
});

const toJob = (row: JobRow): PlatformArtifactJob => ({
  id: row.id,
  artifactId: row.artifactId,
  status: row.status as ArtifactJobStatus,
  progress: row.progress,
  failureCode: row.failureCode,
  params: row.params as Record<string, unknown>,
  checkpoint: row.checkpoint as Record<string, unknown>,
  queueJobKey: row.queueJobKey,
});
