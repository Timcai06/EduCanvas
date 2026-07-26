import { and, eq, sql } from 'drizzle-orm';
import { getDb } from './client';
import { requireNotebookAccess } from './notebook-access';
import { ownsArtifactConversationScope } from './platform-artifact-scope';
import { artifactVersions, artifacts } from './schema';
import {
  ArtifactOwnershipError,
  ArtifactIdempotencyConflictError,
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
    idempotencyKey?: string | null;
    requestFingerprint?: string | null;
  }): Promise<{
    artifact: PlatformArtifact;
    version: PlatformArtifactVersion;
    replayed: boolean;
  }> {
    return await this.database.transaction(async (tx) => {
      if (Boolean(input.idempotencyKey) !== Boolean(input.requestFingerprint)) {
        throw new ArtifactIdempotencyConflictError();
      }
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
            existing.creationRequestFingerprint !== input.requestFingerprint
          ) {
            throw new ArtifactIdempotencyConflictError();
          }
          const [existingVersion] = await tx
            .select()
            .from(artifactVersions)
            .where(
              and(
                eq(artifactVersions.artifactId, existing.id),
                eq(artifactVersions.version, 1),
              ),
            )
            .limit(1);
          if (!existingVersion) throw new ArtifactIdempotencyConflictError();
          return {
            artifact: {
              ...existing,
              trustTier: existing.trustTier as ArtifactTrustTier,
              status: existing.status as PlatformArtifact['status'],
              createdAt: existing.createdAt.toISOString(),
              updatedAt: existing.updatedAt.toISOString(),
            },
            version: {
              ...existingVersion,
              createdAt: existingVersion.createdAt.toISOString(),
            },
            replayed: true,
          };
        }
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
          creationIdempotencyKey: input.idempotencyKey ?? null,
          creationRequestFingerprint: input.requestFingerprint ?? null,
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
        replayed: false,
      };
    });
  }
}
