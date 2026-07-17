import {
  publicArtifactSchema,
  type PublicArtifact,
} from '@educanvas/canvas-protocol';
import {
  artifactGradingKeySchema,
  type ArtifactGradingKey,
} from '@educanvas/canvas-protocol/server';
import { and, eq } from 'drizzle-orm';
import { isDeepStrictEqual } from 'node:util';
import { getDb } from './client';
import { canvasArtifactGradingKeys, canvasArtifacts } from './schema';

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
