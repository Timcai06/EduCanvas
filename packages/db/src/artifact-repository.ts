import {
  publicArtifactSchema,
  type PublicArtifact,
} from '@educanvas/canvas-protocol';
import {
  artifactGradingKeySchema,
  prepareArtifact,
  type ArtifactGradingKey,
} from '@educanvas/canvas-protocol/server';
import { and, eq } from 'drizzle-orm';
import { getDb } from './client';
import { canvasArtifactGradingKeys, canvasArtifacts } from './schema';

type Database = ReturnType<typeof getDb>;

/** 服务端保存完整Artifact后的稳定引用；判分键不会出现在公开读取API中。 */
export interface SavedArtifactReference {
  artifactRecordId: string;
  publicArtifact: PublicArtifact;
}

/**
 * Canvas Artifact的Drizzle仓储。公开投影和私有判分键始终在同一事务中创建，
 * 防止出现“页面已展示但服务端无法判分”或“答案存在但题面不存在”的半完成状态。
 */
export class DrizzleArtifactRepository {
  constructor(private readonly providedDatabase?: Database) {}

  private get database(): Database {
    return this.providedDatabase ?? getDb();
  }

  async save(
    sessionId: string,
    completeArtifact: unknown,
  ): Promise<SavedArtifactReference> {
    const prepared = prepareArtifact(completeArtifact);
    return this.database.transaction(async (transaction) => {
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
      return {
        artifactRecordId: artifactRow.id,
        publicArtifact: prepared.publicArtifact,
      };
    });
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
