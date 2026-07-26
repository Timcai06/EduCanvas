import { getDb } from './client';
import { requireNotebookAccess } from './notebook-access';
import { ownsArtifactConversationScope } from './platform-artifact-scope';
import { artifactVersions, artifacts } from './schema';
import {
  ArtifactOwnershipError,
  type ArtifactTrustTier,
  type PlatformArtifact,
  type PlatformArtifactVersion,
} from './platform-artifact-repository';

type Database = ReturnType<typeof getDb>;

/**
 * 用户直接创作 Artifact 的原子写入边界。这里不创建 generation job；
 * 模型产物必须继续走 DrizzlePlatformArtifactRepository 的持久任务入口。
 */
export class DrizzleManualArtifactRepository {
  constructor(private readonly providedDatabase?: Database) {}

  private get database(): Database {
    return this.providedDatabase ?? getDb();
  }

  /**
   * 原子创建 active Artifact 与首个不可变版本。Space 所有权、Artifact 行
   * 和 v1 在同一事务提交，任一失败全部回滚。
   */
  async createWithInitialVersion(input: {
    spaceId: string;
    conversationId?: string | null;
    trustedSubjectId: string;
    kind: string;
    trustTier: ArtifactTrustTier;
    title: string;
    content: unknown;
    generatedBy: string;
  }): Promise<{
    artifact: PlatformArtifact;
    version: PlatformArtifactVersion;
  }> {
    return await this.database.transaction(async (tx) => {
      const hasAccess = input.conversationId
        ? await ownsArtifactConversationScope(tx, {
            spaceId: input.spaceId,
            conversationId: input.conversationId,
            trustedSubjectId: input.trustedSubjectId,
          })
        : Boolean(
            await requireNotebookAccess(tx, {
              notebookId: input.spaceId,
              trustedSubjectId: input.trustedSubjectId,
              requiredPermission: 'artifact.write',
            }).catch(() => null),
          );
      if (!hasAccess) {
        throw new ArtifactOwnershipError();
      }

      const [artifact] = await tx
        .insert(artifacts)
        .values({
          spaceId: input.spaceId,
          conversationId: input.conversationId ?? null,
          ownerSubjectId: input.trustedSubjectId,
          kind: input.kind,
          trustTier: input.trustTier,
          title: input.title,
          status: 'active',
          latestVersion: 1,
        })
        .returning();
      const [version] = await tx
        .insert(artifactVersions)
        .values({
          artifactId: artifact!.id,
          version: 1,
          content: input.content,
          generatedBy: input.generatedBy,
        })
        .returning();

      return {
        artifact: {
          ...artifact!,
          trustTier: artifact!.trustTier as ArtifactTrustTier,
          status: 'active',
          createdAt: artifact!.createdAt.toISOString(),
          updatedAt: artifact!.updatedAt.toISOString(),
        },
        version: {
          ...version!,
          createdAt: version!.createdAt.toISOString(),
        },
      };
    });
  }
}
