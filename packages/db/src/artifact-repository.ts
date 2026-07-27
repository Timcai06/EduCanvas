import {
  publicArtifactSchema,
  type PublicArtifact,
} from '@educanvas/canvas-protocol';
import {
  artifactGradingKeySchema,
  type ArtifactGradingKey,
} from '@educanvas/canvas-protocol/server';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { isDeepStrictEqual } from 'node:util';
import { getDb } from './client';
import {
  artifactVersions,
  artifacts,
  canvasArtifactGradingKeys,
  canvasArtifacts,
  conversations,
  lessonSessions,
} from './schema';

type Database = ReturnType<typeof getDb>;
type DatabaseTransaction = Parameters<
  Parameters<Database['transaction']>[0]
>[0];

/** 同一Artifact ID出现不同公开内容或判分键时拒绝静默覆盖。 */
export class ArtifactContentConflictError extends Error {
  constructor(artifactId: string) {
    super(`Canvas Artifact ${artifactId}已存在但内容不一致`);
    this.name = 'ArtifactContentConflictError';
  }
}

export class ArtifactBridgeInvariantError extends Error {
  readonly code = 'artifact_bridge_invariant_failed';

  constructor() {
    super('K12 Artifact platform bridge invariant failed');
    this.name = 'ArtifactBridgeInvariantError';
  }
}

function toJsonValue<T>(value: T): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown;
}

/** 在调用方现有事务内幂等保存K12公开题面与私有判分键。 */
export async function ensurePreparedArtifact(
  transaction: DatabaseTransaction,
  sessionId: string,
  prepared: {
    publicArtifact: PublicArtifact;
    gradingKey: ArtifactGradingKey;
  },
): Promise<void> {
  // 同一学习会话的同名产物可能被并发重试；事务级锁把“检查后插入”串行化，
  // 避免把唯一键竞争误报为业务失败。锁随调用方事务提交或回滚自动释放。
  await transaction.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`${sessionId}:${prepared.publicArtifact.artifactId}`}, 0))`,
  );

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

  // 新 K12 快照与平台身份必须在调用方的同一事务中一起提交。
  await bridgeCanvasArtifactToPlatform(
    transaction,
    artifactRow.id,
    prepared.publicArtifact,
  );
}

/**
 * K12 Artifact → 平台 Artifact 桥接（ADR-0011）。
 *
 * 在同一事务内为 canvas_artifacts 行创建平台 artifacts + artifact_versions 长期身份，
 * 并回写 platformArtifactId / platformArtifactVersionId。幂等：已桥接则跳过。
 *
 * 禁止把 gradingKey 写入 artifacts 或 artifact_versions；
 * 平台版本 content 仅保存浏览器安全投影（publicArtifact.params）。
 *
 * 没有 Conversation 的兼容 Session 暂不桥接；已有旧快照也不会被此路径回填。
 */
async function bridgeCanvasArtifactToPlatform(
  transaction: DatabaseTransaction,
  canvasArtifactRecordId: string,
  publicArtifact: PublicArtifact,
): Promise<void> {
  const [current] = await transaction
    .select({
      platformArtifactId: canvasArtifacts.platformArtifactId,
      platformArtifactVersionId: canvasArtifacts.platformArtifactVersionId,
      conversationId: lessonSessions.conversationId,
      studentId: lessonSessions.studentId,
      spaceId: conversations.spaceId,
    })
    .from(canvasArtifacts)
    .innerJoin(lessonSessions, eq(lessonSessions.id, canvasArtifacts.sessionId))
    .leftJoin(
      conversations,
      eq(conversations.id, lessonSessions.conversationId),
    )
    .where(eq(canvasArtifacts.id, canvasArtifactRecordId))
    .limit(1);
  if (!current) throw new ArtifactBridgeInvariantError();
  if (current.platformArtifactId && current.platformArtifactVersionId) return;
  if (current.platformArtifactId || current.platformArtifactVersionId) {
    throw new ArtifactBridgeInvariantError();
  }
  if (!current.conversationId || !current.spaceId) return;

  const [platformArtifact] = await transaction
    .insert(artifacts)
    .values({
      spaceId: current.spaceId,
      conversationId: current.conversationId,
      ownerSubjectId: current.studentId,
      kind: publicArtifact.type,
      trustTier: 'tier1',
      title: publicArtifact.title,
      status: 'active',
      latestVersion: 1,
    })
    .returning({ id: artifacts.id });
  if (!platformArtifact) throw new ArtifactBridgeInvariantError();

  const [platformVersion] = await transaction
    .insert(artifactVersions)
    .values({
      artifactId: platformArtifact.id,
      version: 1,
      content: publicArtifact.params,
      generatedBy: 'k12:bootstrap',
    })
    .returning({ id: artifactVersions.id });
  if (!platformVersion) throw new ArtifactBridgeInvariantError();

  const [linked] = await transaction
    .update(canvasArtifacts)
    .set({
      platformArtifactId: platformArtifact.id,
      platformArtifactVersionId: platformVersion.id,
    })
    .where(
      and(
        eq(canvasArtifacts.id, canvasArtifactRecordId),
        isNull(canvasArtifacts.platformArtifactId),
        isNull(canvasArtifacts.platformArtifactVersionId),
      ),
    )
    .returning({ id: canvasArtifacts.id });
  if (!linked) throw new ArtifactBridgeInvariantError();
}

/** Canvas Artifact读取仓储；写入统一由ensurePreparedArtifact加入调用方事务。 */
export class DrizzleArtifactRepository {
  constructor(private readonly providedDatabase?: Database) {}

  private get database(): Database {
    return this.providedDatabase ?? getDb();
  }

  /** 页面和客户端数据加载只能调用此方法，它在类型和查询层都不接触判分键表。 */
  async getPublicBySession(
    sessionId: string,
    artifactId: string,
  ): Promise<PublicArtifact | null> {
    const [row] = await this.database
      .select()
      .from(canvasArtifacts)
      .where(
        and(
          eq(canvasArtifacts.sessionId, sessionId),
          eq(canvasArtifacts.artifactId, artifactId),
        ),
      )
      .limit(1);
    if (!row) return null;
    return publicArtifactSchema.parse({
      schemaVersion: row.schemaVersion,
      artifactId: row.artifactId,
      type: row.type,
      title: row.title,
      params: row.params,
    });
  }

  /** 仅供服务端判分器读取；调用方不能把返回值序列化到页面或Route Handler响应。 */
  async getGradingKey(
    sessionId: string,
    artifactId: string,
  ): Promise<ArtifactGradingKey | null> {
    const [row] = await this.database
      .select({ gradingKey: canvasArtifactGradingKeys.gradingKey })
      .from(canvasArtifacts)
      .innerJoin(
        canvasArtifactGradingKeys,
        eq(canvasArtifactGradingKeys.artifactRecordId, canvasArtifacts.id),
      )
      .where(
        and(
          eq(canvasArtifacts.sessionId, sessionId),
          eq(canvasArtifacts.artifactId, artifactId),
        ),
      )
      .limit(1);
    return row ? artifactGradingKeySchema.parse(row.gradingKey) : null;
  }
}
