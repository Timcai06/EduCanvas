import { and, desc, eq, inArray, lt, ne, or, sql } from 'drizzle-orm';
import type { NotebookPermission } from '@educanvas/gateway-core';
import { getDb } from './client';
import { requireNotebookAccess } from './notebook-access';
import {
  boundedPageLimit,
  type CursorPage,
  type TemporalIdCursor,
} from './pagination';
import {
  artifactGenerationJobs,
  artifactVersions,
  artifacts,
  conversations,
} from './schema';
import { archiveOwnedArtifactTransaction } from './platform-artifact-archive';
import { ownsArtifactConversationScope } from './platform-artifact-scope';

type Database = ReturnType<typeof getDb>;
type DatabaseTransaction = Parameters<
  Parameters<Database['transaction']>[0]
>[0];
type DatabaseExecutor = Database | DatabaseTransaction;

async function requireArtifactNotebookAccess(
  executor: DatabaseExecutor,
  input: {
    spaceId: string;
    trustedSubjectId: string;
    permission: NotebookPermission;
  },
): Promise<void> {
  await requireNotebookAccess(executor, {
    notebookId: input.spaceId,
    trustedSubjectId: input.trustedSubjectId,
    requiredPermission: input.permission,
  }).catch(() => {
    throw new ArtifactOwnershipError();
  });
}

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

/**
 * 幂等键已存在但请求指纹不一致。同一键只能绑定同一个创建请求，
 * 否则客户端复用键重放会静默拿到另一请求的结果，必须显式拒绝。
 */
export class ArtifactIdempotencyConflictError extends Error {
  readonly code = 'artifact_idempotency_conflict';

  constructor() {
    super('相同幂等键已绑定不同的产物创建请求');
    this.name = 'ArtifactIdempotencyConflictError';
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
  createdByOperationId: string | null;
  generatedBy: string | null;
  generationJobId: string | null;
  createdAt: string;
}

export interface PlatformArtifactJob {
  id: string;
  artifactId: string;
  operationId: string | null;
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
 * 平台 Artifact 一等公民仓储(ADR-0005)。调用边界:
 * - 所有读写都要求可信主体(trustedSubjectId),所有权不匹配一律 ArtifactOwnershipError;
 * - 版本不可变:只提供 append,写入在事务内锁产物行并单调递增 latestVersion;
 * - trust tier 只在创建时确定,之后不可修改——层级迁移必须新建产物(ADR-0004 升级通道)。
 * 与 K12 `canvas_artifacts`(题面/判分键)无关,后者仍由 artifact-repository.ts 服务。
 */
export class DrizzlePlatformArtifactRepository {
  constructor(private readonly providedDatabase?: Database) {}

  private get database(): Database {
    return this.providedDatabase ?? getDb();
  }

  /**
   * 创建产物空壳（不含版本内容），供后续 appendVersion / 生成任务填充。
   * 权限由 requireArtifactNotebookAccess 校验 artifact.write；仅写 artifacts 行，
   * 不触碰对象存储；无权限或 Notebook 不存在时抛 ArtifactOwnershipError。
   */
  async createArtifact(input: {
    spaceId: string;
    conversationId?: string | null;
    trustedSubjectId: string;
    kind: string;
    trustTier: ArtifactTrustTier;
    title: string;
    status?: Extract<ArtifactStatus, 'proposed' | 'active'>;
  }): Promise<PlatformArtifact> {
    await requireArtifactNotebookAccess(this.database, {
      spaceId: input.spaceId,
      trustedSubjectId: input.trustedSubjectId,
      permission: 'artifact.write',
    });

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

  /**
   * 按 id 读产物元数据。先查行、行不存在直接抛 ArtifactOwnershipError，
   * 再校验 notebook.read——查无此物与无权同错，避免客户端探测资源是否存在。
   */
  async getArtifact(input: {
    artifactId: string;
    trustedSubjectId: string;
  }): Promise<PlatformArtifact> {
    const [row] = await this.database
      .select()
      .from(artifacts)
      .where(eq(artifacts.id, input.artifactId))
      .limit(1);
    if (!row) throw new ArtifactOwnershipError();
    await requireArtifactNotebookAccess(this.database, {
      spaceId: row.spaceId,
      trustedSubjectId: input.trustedSubjectId,
      permission: 'notebook.read',
    });
    return toArtifact(row);
  }

  /**
   * 列出某次会话产生的未归档产物。先经 conversation 行解析其 spaceId 再验权；
   * 会话不存在或无权访问一律 ArtifactOwnershipError，防止探测会话归属。
   */
  async listConversationArtifacts(input: {
    conversationId: string;
    trustedSubjectId: string;
    limit?: number;
  }): Promise<readonly PlatformArtifact[]> {
    const [conversation] = await this.database
      .select({ spaceId: conversations.spaceId })
      .from(conversations)
      .where(eq(conversations.id, input.conversationId))
      .limit(1);
    if (!conversation) throw new ArtifactOwnershipError();
    await requireArtifactNotebookAccess(this.database, {
      spaceId: conversation.spaceId,
      trustedSubjectId: input.trustedSubjectId,
      permission: 'notebook.read',
    });
    const rows = await this.database
      .select()
      .from(artifacts)
      .where(
        and(
          eq(artifacts.conversationId, input.conversationId),
          ne(artifacts.status, 'archived'),
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
    kinds?: readonly string[];
  }): Promise<readonly PlatformArtifact[]> {
    return (await this.listSpaceArtifactsPage(input)).items;
  }

  async listSpaceArtifactsPage(input: {
    spaceId: string;
    trustedSubjectId: string;
    limit?: number;
    cursor?: TemporalIdCursor | null;
    /** 消费端尚未注册的类型应在数据库分页前排除，避免产生不可打开的列表项。 */
    kinds?: readonly string[];
  }): Promise<CursorPage<PlatformArtifact>> {
    await requireArtifactNotebookAccess(this.database, {
      spaceId: input.spaceId,
      trustedSubjectId: input.trustedSubjectId,
      permission: 'notebook.read',
    });
    const rows = await this.database
      .select()
      .from(artifacts)
      .where(
        and(
          eq(artifacts.spaceId, input.spaceId),
          ne(artifacts.status, 'archived'),
          input.kinds?.length
            ? inArray(artifacts.kind, [...input.kinds])
            : undefined,
          input.cursor
            ? or(
                lt(artifacts.updatedAt, input.cursor.timestamp),
                and(
                  eq(artifacts.updatedAt, input.cursor.timestamp),
                  lt(artifacts.id, input.cursor.id),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(desc(artifacts.updatedAt), desc(artifacts.id))
      .limit(boundedPageLimit(input.limit) + 1);
    const limit = boundedPageLimit(input.limit);
    const pageRows = rows.slice(0, limit);
    const last = pageRows.at(-1);
    return {
      items: pageRows.map(toArtifact),
      nextCursor:
        rows.length > limit && last
          ? { timestamp: last.updatedAt, id: last.id }
          : null,
    };
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
            spaceId: artifacts.spaceId,
            latestVersion: artifacts.latestVersion,
          })
          .from(artifacts)
          .where(eq(artifacts.id, input.artifactId))
          .for('update')
          .limit(1);
        if (!artifact) {
          throw new ArtifactOwnershipError();
        }
        await requireArtifactNotebookAccess(tx, {
          spaceId: artifact.spaceId,
          trustedSubjectId: input.trustedSubjectId,
          permission: 'artifact.write',
        });
        if (
          input.expectedLatestVersion !== undefined &&
          artifact.latestVersion !== input.expectedLatestVersion
        ) {
          throw new ArtifactRevisionConflictError('stale_version');
        }

        if (input.generationJobId) {
          const [existingVersion] = await tx
            .select()
            .from(artifactVersions)
            .where(
              and(
                eq(artifactVersions.artifactId, input.artifactId),
                eq(artifactVersions.generationJobId, input.generationJobId),
              ),
            )
            .limit(1);
          if (existingVersion) {
            throw new ArtifactVersionConflictError();
          }
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

  /**
   * 追加不可变版本并原子落成功终态；先持有 job 行锁，若任务不在 running，
   * 整个写入回滚，不产生“版本已写但终态未写”。
   */
  async appendVersionAndCompleteGenerationJob(input: {
    jobId: string;
    artifactId: string;
    trustedSubjectId: string;
    content?: unknown;
    metadata?: Record<string, unknown> | null;
    objectKey?: string;
    checksum?: string;
    generatedBy?: string | null;
    createdByOperationId?: string | null;
    /** Canvas 共创的乐观并发基线；首版生成不传。 */
    expectedLatestVersion?: number;
    progress?: number | null;
  }): Promise<PlatformArtifactVersion> {
    try {
      return await this.database.transaction(async (tx) => {
        const [artifact] = await tx
          .select({
            id: artifacts.id,
            spaceId: artifacts.spaceId,
            latestVersion: artifacts.latestVersion,
          })
          .from(artifacts)
          .where(eq(artifacts.id, input.artifactId))
          .for('update')
          .limit(1);
        if (!artifact) {
          throw new ArtifactOwnershipError();
        }
        await requireArtifactNotebookAccess(tx, {
          spaceId: artifact.spaceId,
          trustedSubjectId: input.trustedSubjectId,
          permission: 'artifact.write',
        });

        const [job] = await tx
          .select({
            id: artifactGenerationJobs.id,
            status: artifactGenerationJobs.status,
            startedAt: artifactGenerationJobs.startedAt,
          })
          .from(artifactGenerationJobs)
          .where(
            and(
              eq(artifactGenerationJobs.id, input.jobId),
              eq(artifactGenerationJobs.artifactId, input.artifactId),
            ),
          )
          .for('update', { of: artifactGenerationJobs })
          .limit(1);
        if (!job) {
          throw new ArtifactOwnershipError();
        }
        if (job.status !== 'running') {
          throw new ArtifactJobLifecycleError(job.status, 'succeeded');
        }

        if (
          input.expectedLatestVersion !== undefined &&
          artifact.latestVersion !== input.expectedLatestVersion
        ) {
          throw new ArtifactRevisionConflictError('stale_version');
        }

        const [existingVersion] = await tx
          .select()
          .from(artifactVersions)
          .where(
            and(
              eq(artifactVersions.artifactId, input.artifactId),
              eq(artifactVersions.generationJobId, input.jobId),
            ),
          )
          .limit(1);
        if (existingVersion) {
          throw new ArtifactVersionConflictError();
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
            generationJobId: input.jobId,
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
        await tx
          .update(artifactGenerationJobs)
          .set({
            status: 'succeeded',
            progress: input.progress ?? 100,
            failureCode: null,
            startedAt: job.startedAt,
            completedAt: sql`now()`,
          })
          .where(eq(artifactGenerationJobs.id, input.jobId));

        return toVersion(version!);
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new ArtifactVersionConflictError();
      throw error;
    }
  }

  /**
   * 产物的全部版本（含归档前版本），按版本号降序。所有权校验复用 getArtifact；
   * 返回的行含 objectKey 等内部字段，仅供服务端消费，浏览器可见形状由
   * canvas-protocol 的投影层裁剪。
   */
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

  /**
   * 按版本号读单版本。版本不存在同样抛 ArtifactOwnershipError（查无此物同错）；
   * 返回含 objectKey 的完整行，仅限服务端消费，浏览器投影由 canvas-protocol 裁剪。
   */
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

  /**
   * 为已有产物手动创建生成任务账本行（不入队、queueJobKey 可空），供编排方
   * 自行把任务交给队列或直接推进状态机；所有权校验复用 getArtifact。
   */
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
          spaceId: artifacts.spaceId,
        })
        .from(artifactGenerationJobs)
        .innerJoin(
          artifacts,
          eq(artifactGenerationJobs.artifactId, artifacts.id),
        )
        .where(eq(artifactGenerationJobs.id, input.jobId))
        .for('update', { of: artifactGenerationJobs })
        .limit(1);
      if (!row) {
        throw new ArtifactOwnershipError();
      }
      await requireArtifactNotebookAccess(tx, {
        spaceId: row.spaceId,
        trustedSubjectId: input.trustedSubjectId,
        permission: 'artifact.write',
      });

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
      .select({
        job: artifactGenerationJobs,
        spaceId: artifacts.spaceId,
      })
      .from(artifactGenerationJobs)
      .innerJoin(artifacts, eq(artifactGenerationJobs.artifactId, artifacts.id))
      .where(eq(artifactGenerationJobs.id, input.jobId))
      .limit(1);
    if (!row) throw new ArtifactOwnershipError();
    await requireArtifactNotebookAccess(this.database, {
      spaceId: row.spaceId,
      trustedSubjectId: input.trustedSubjectId,
      permission: 'notebook.read',
    });
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
          spaceId: artifacts.spaceId,
        })
        .from(artifactGenerationJobs)
        .innerJoin(
          artifacts,
          eq(artifactGenerationJobs.artifactId, artifacts.id),
        )
        .where(eq(artifactGenerationJobs.id, input.jobId))
        .for('update', { of: artifactGenerationJobs })
        .limit(1);
      if (!row) {
        throw new ArtifactOwnershipError();
      }
      await requireArtifactNotebookAccess(tx, {
        spaceId: row.spaceId,
        trustedSubjectId: input.trustedSubjectId,
        permission: 'artifact.write',
      });
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
   * 提议产物并原子入队生成任务(ADR-0005 的核心承诺):产物行、任务账本行与
   * graphile 队列行在同一事务提交,回滚则三者俱无。依赖 `graphile_worker`
   * schema 已由 worker 首次启动时自迁移建立;worker 从未启动过的环境会以
   * storage 异常诚实失败,不做静默降级。
   */
  async createArtifactWithGenerationJob(input: {
    spaceId: string;
    conversationId: string;
    trustedSubjectId: string;
    /** 仅 Agent Turn 创建时传入；用于把产物恢复到对应助手消息末尾。 */
    operationId?: string | null;
    kind: string;
    trustTier: ArtifactTrustTier;
    title: string;
    taskIdentifier: string;
    params?: Record<string, unknown>;
    maxAttempts?: number;
    idempotencyKey?: string | null;
    requestFingerprint?: string | null;
  }): Promise<{
    artifact: PlatformArtifact;
    job: PlatformArtifactJob;
    replayed: boolean;
  }> {
    return await this.database.transaction(async (tx) => {
      if (Boolean(input.idempotencyKey) !== Boolean(input.requestFingerprint)) {
        throw new ArtifactIdempotencyConflictError();
      }
      if (!(await ownsArtifactConversationScope(tx, input))) {
        throw new ArtifactOwnershipError();
      }
      if (input.idempotencyKey) {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`artifact-create:${input.trustedSubjectId}:${input.idempotencyKey}`}, 0))`,
        );
        const [existing] = await tx
          .select()
          .from(artifacts)
          .where(
            and(
              eq(artifacts.ownerSubjectId, input.trustedSubjectId),
              eq(artifacts.creationIdempotencyKey, input.idempotencyKey),
            ),
          )
          .limit(1);
        if (existing) {
          if (
            !input.requestFingerprint ||
            existing.creationRequestFingerprint !== input.requestFingerprint
          ) {
            throw new ArtifactIdempotencyConflictError();
          }
          const [existingJob] = await tx
            .select()
            .from(artifactGenerationJobs)
            .where(eq(artifactGenerationJobs.artifactId, existing.id))
            .orderBy(desc(artifactGenerationJobs.createdAt))
            .limit(1);
          if (!existingJob) throw new ArtifactIdempotencyConflictError();
          return {
            artifact: toArtifact(existing),
            job: toJob(existingJob),
            replayed: true,
          };
        }
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
          creationIdempotencyKey: input.idempotencyKey ?? null,
          creationRequestFingerprint: input.requestFingerprint ?? null,
        })
        .returning();
      const artifact = toArtifact(artifactRow!);

      const queueJobKey = `artifact-generate:${artifact.id}`;
      const [jobRow] = await tx
        .insert(artifactGenerationJobs)
        .values({
          artifactId: artifact.id,
          operationId: input.operationId ?? null,
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

      return { artifact, job, replayed: false };
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
        artifactRow.conversationId !== input.conversationId ||
        artifactRow.status !== 'active'
      ) {
        throw new ArtifactOwnershipError();
      }
      await requireArtifactNotebookAccess(tx, {
        spaceId: artifactRow.spaceId,
        trustedSubjectId: input.trustedSubjectId,
        permission: 'artifact.write',
      });
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

  /**
   * 归档产物并原子登记对象删除意图。状态变化与删除 outbox 位于同一事务，
   * 保证后台物理删除不会遗漏已归档产物的版本对象。
   * 重复归档幂等：已归档产物直接返回 false。
   */
  async archiveOwnedArtifact(input: {
    artifactId: string;
    trustedSubjectId: string;
    notebookId: string;
  }): Promise<boolean> {
    return archiveOwnedArtifactTransaction(this.database, input);
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
    return this.database.transaction(
      async (tx) => {
        const [artifactRow] = await tx
          .select()
          .from(artifacts)
          .where(eq(artifacts.id, input.artifactId))
          .limit(1);
        if (!artifactRow) throw new ArtifactOwnershipError();
        await requireArtifactNotebookAccess(tx, {
          spaceId: artifactRow.spaceId,
          trustedSubjectId: input.trustedSubjectId,
          permission: 'notebook.read',
        });

        const [versionRow] = await tx
          .select()
          .from(artifactVersions)
          .where(eq(artifactVersions.artifactId, artifactRow.id))
          .orderBy(desc(artifactVersions.version))
          .limit(1);
        const [jobRow] = await tx
          .select()
          .from(artifactGenerationJobs)
          .where(eq(artifactGenerationJobs.artifactId, artifactRow.id))
          .orderBy(desc(artifactGenerationJobs.createdAt))
          .limit(1);
        return {
          artifact: toArtifact(artifactRow),
          latestVersion: versionRow ? toVersion(versionRow) : null,
          latestJob: jobRow ? toJob(jobRow) : null,
        };
      },
      // Worker 在同一事务提交 Version 与 latestVersion；详情读取必须共享快照，
      // 否则 READ COMMITTED 可拼出旧 Artifact 与新 Version 的不可能聚合。
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    );
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
  createdByOperationId: row.createdByOperationId,
  generatedBy: row.generatedBy,
  generationJobId: row.generationJobId,
  createdAt: row.createdAt.toISOString(),
});

const toJob = (row: JobRow): PlatformArtifactJob => ({
  id: row.id,
  artifactId: row.artifactId,
  operationId: row.operationId,
  status: row.status as ArtifactJobStatus,
  progress: row.progress,
  failureCode: row.failureCode,
  params: row.params as Record<string, unknown>,
  checkpoint: row.checkpoint as Record<string, unknown>,
  queueJobKey: row.queueJobKey,
});
