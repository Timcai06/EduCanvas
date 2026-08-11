import { and, desc, eq } from 'drizzle-orm';
import { getDb } from './client';
import { notebookSurfacePositions } from './schema';

type Database = ReturnType<typeof getDb>;
export type NotebookSurfacePositionRow =
  typeof notebookSurfacePositions.$inferSelect;

export interface SaveNotebookSurfacePositionInput {
  readonly spaceId: string;
  readonly ownerSubjectId: string;
  readonly resourceKind: 'source' | 'artifact';
  readonly resourceId: string;
  readonly zone: 'center' | 'periphery' | 'margin';
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly restState: 'open' | 'folded' | 'pinned';
}

function validCoordinate(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

export class NotebookSurfacePositionValidationError extends Error {
  override readonly name = 'NotebookSurfacePositionValidationError';
}

/** 私有案面快照；所有读写都同时限定 space 与 owner，协作成员互不覆盖。 */
export class DrizzleNotebookSurfacePositionRepository {
  constructor(private readonly providedDatabase?: Database) {}

  private get database(): Database {
    return this.providedDatabase ?? getDb();
  }

  async list(input: {
    readonly spaceId: string;
    readonly ownerSubjectId: string;
  }): Promise<readonly NotebookSurfacePositionRow[]> {
    return this.database
      .select()
      .from(notebookSurfacePositions)
      .where(
        and(
          eq(notebookSurfacePositions.spaceId, input.spaceId),
          eq(notebookSurfacePositions.ownerSubjectId, input.ownerSubjectId),
        ),
      )
      .orderBy(desc(notebookSurfacePositions.updatedAt));
  }

  async save(
    input: SaveNotebookSurfacePositionInput,
  ): Promise<NotebookSurfacePositionRow> {
    if (
      !validCoordinate(input.x) ||
      !validCoordinate(input.y) ||
      !Number.isInteger(input.z) ||
      input.z < 0 ||
      input.z > 100
    ) {
      throw new NotebookSurfacePositionValidationError(
        '案面坐标必须位于归一化边界内。',
      );
    }
    const [row] = await this.database
      .insert(notebookSurfacePositions)
      .values(input)
      .onConflictDoUpdate({
        target: [
          notebookSurfacePositions.spaceId,
          notebookSurfacePositions.ownerSubjectId,
          notebookSurfacePositions.resourceKind,
          notebookSurfacePositions.resourceId,
        ],
        set: {
          zone: input.zone,
          x: input.x,
          y: input.y,
          z: input.z,
          restState: input.restState,
          updatedAt: new Date(),
        },
      })
      .returning();
    if (!row) throw new Error('surface position upsert returned no row');
    return row;
  }
}
