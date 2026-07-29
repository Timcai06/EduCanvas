import { and, eq, isNotNull } from 'drizzle-orm';
import { getDb } from './client';
import { requireNotebookAccess } from './notebook-access';
import { artifactVersions, artifacts, objectDeletionOutbox } from './schema';

type Database = ReturnType<typeof getDb>;

/**
 * 在同一事务中锁定并归档产物，同时为所有对象版本登记物理删除意图。
 * 锁定 active 行可让并发删除保持幂等，且不会出现归档成功但漏写 outbox。
 */
export async function archiveOwnedArtifactTransaction(
  database: Database,
  input: {
    artifactId: string;
    trustedSubjectId: string;
    notebookId: string;
  },
): Promise<boolean> {
  const now = new Date();
  return database.transaction(async (transaction) => {
    const access = await requireNotebookAccess(transaction, {
      notebookId: input.notebookId,
      trustedSubjectId: input.trustedSubjectId,
      requiredPermission: 'artifact.write',
      now,
    }).catch(() => null);
    if (!access) return false;

    const [artifactRow] = await transaction
      .select({
        id: artifacts.id,
        ownerSubjectId: artifacts.ownerSubjectId,
      })
      .from(artifacts)
      .where(
        and(
          eq(artifacts.id, input.artifactId),
          eq(artifacts.spaceId, input.notebookId),
          eq(artifacts.status, 'active'),
        ),
      )
      .for('update')
      .limit(1);
    if (!artifactRow) return false;
    if (
      artifactRow.ownerSubjectId !== input.trustedSubjectId &&
      access.role !== 'owner' &&
      access.role !== 'editor'
    ) {
      return false;
    }

    const versions = await transaction
      .select({
        id: artifactVersions.id,
        objectKey: artifactVersions.objectKey,
      })
      .from(artifactVersions)
      .where(
        and(
          eq(artifactVersions.artifactId, input.artifactId),
          isNotNull(artifactVersions.objectKey),
        ),
      );
    const deletionEntries = versions.flatMap((version) =>
      version.objectKey
        ? [
            {
              objectKind: 'artifact' as const,
              storageKey: version.objectKey,
              sourceType: 'artifact_version' as const,
              sourceId: version.id,
              availableAt: now,
            },
          ]
        : [],
    );
    if (deletionEntries.length > 0) {
      await transaction
        .insert(objectDeletionOutbox)
        .values(deletionEntries)
        .onConflictDoNothing();
    }

    const archived = await transaction
      .update(artifacts)
      .set({
        status: 'archived',
        archivedAt: now,
        updatedAt: now,
      })
      .where(
        and(eq(artifacts.id, input.artifactId), eq(artifacts.status, 'active')),
      )
      .returning({ id: artifacts.id });
    return archived.length === 1;
  });
}
