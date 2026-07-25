import { and, asc, eq, inArray } from 'drizzle-orm';
import { getDb } from './client';
import { artifactGenerationJobs, artifacts } from './schema';
import type {
  ArtifactStatus,
  ArtifactTrustTier,
  PlatformArtifact,
} from './platform-artifact-repository';

type Database = ReturnType<typeof getDb>;

/** Agent Turn 与其创建的持久产物之间的只读关联。 */
export interface PlatformArtifactTurnReference {
  operationId: string;
  artifact: PlatformArtifact;
}

/**
 * 读取 Agent Turn 创建的产物引用。
 *
 * 调用边界：只接受同一 Conversation 内最多 100 个 Operation；查询同时收紧
 * Artifact 主体与 Conversation，越权结果表现为空，不能用来探测其他 Notebook。
 * Studio 与消息流都继续读取 Artifact 事实，不复制产物内容或生成状态。
 */
export class DrizzlePlatformArtifactTurnReferenceRepository {
  constructor(private readonly providedDatabase?: Database) {}

  private get database(): Database {
    return this.providedDatabase ?? getDb();
  }

  async listForOperations(input: {
    conversationId: string;
    trustedSubjectId: string;
    operationIds: readonly string[];
  }): Promise<readonly PlatformArtifactTurnReference[]> {
    const operationIds = [...new Set(input.operationIds)];
    if (operationIds.length === 0) return [];
    if (operationIds.length > 100) {
      throw new Error('artifact_turn_reference_operation_limit_exceeded');
    }

    const rows = await this.database
      .select({
        operationId: artifactGenerationJobs.operationId,
        artifact: artifacts,
      })
      .from(artifactGenerationJobs)
      .innerJoin(artifacts, eq(artifacts.id, artifactGenerationJobs.artifactId))
      .where(
        and(
          inArray(artifactGenerationJobs.operationId, operationIds),
          eq(artifacts.conversationId, input.conversationId),
          eq(artifacts.ownerSubjectId, input.trustedSubjectId),
        ),
      )
      .orderBy(
        asc(artifactGenerationJobs.createdAt),
        asc(artifactGenerationJobs.id),
      );

    return rows.flatMap((row) =>
      row.operationId
        ? [
            {
              operationId: row.operationId,
              artifact: {
                id: row.artifact.id,
                spaceId: row.artifact.spaceId,
                conversationId: row.artifact.conversationId,
                ownerSubjectId: row.artifact.ownerSubjectId,
                kind: row.artifact.kind,
                trustTier: row.artifact.trustTier as ArtifactTrustTier,
                title: row.artifact.title,
                status: row.artifact.status as ArtifactStatus,
                latestVersion: row.artifact.latestVersion,
                createdAt: row.artifact.createdAt.toISOString(),
                updatedAt: row.artifact.updatedAt.toISOString(),
              },
            },
          ]
        : [],
    );
  }
}
