import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { getDb } from './client';
import { lessonSessions, turnContextSnapshots } from './schema';
import { LearningSessionOwnershipError } from './chat-repository';

type Database = ReturnType<typeof getDb>;

export interface RecordTurnContextInput {
  sessionId: string;
  trustedStudentId: string;
  turnId: string;
  builderVersion: string;
  includedMessageIds: readonly string[];
  selectedAssetVersionIds: readonly string[];
  omittedMessageCount: number;
  characterCount: number;
  now?: Date;
}

export type TurnContextMaterial = Omit<
  RecordTurnContextInput,
  'sessionId' | 'trustedStudentId' | 'turnId' | 'now'
>;

export interface PreparedTurnContextMaterial extends TurnContextMaterial {
  includedMessageIds: string[];
  selectedAssetVersionIds: string[];
  contextHash: string;
}

export interface TurnContextSnapshot {
  id: string;
  sessionId: string;
  turnId: string;
  builderVersion: string;
  includedMessageIds: readonly string[];
  selectedAssetVersionIds: readonly string[];
  omittedMessageCount: number;
  characterCount: number;
  contextHash: string;
  createdAt: string;
}

export class TurnContextConflictError extends Error {
  readonly code = 'turn_context_conflict';

  constructor() {
    super('同一 Turn 已绑定不同的上下文快照');
    this.name = 'TurnContextConflictError';
  }
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateIds(values: readonly string[]): string[] {
  if (
    values.length > 100 ||
    values.some((value) => !UUID_PATTERN.test(value))
  ) {
    throw new TurnContextConflictError();
  }
  return [...values];
}

export function prepareTurnContextMaterial(
  input: TurnContextMaterial,
): PreparedTurnContextMaterial {
  if (
    !input.builderVersion ||
    input.builderVersion.length > 128 ||
    !Number.isInteger(input.omittedMessageCount) ||
    input.omittedMessageCount < 0 ||
    !Number.isInteger(input.characterCount) ||
    input.characterCount < 0 ||
    input.characterCount > 128_000
  ) {
    throw new TurnContextConflictError();
  }
  const includedMessageIds = validateIds(input.includedMessageIds);
  const selectedAssetVersionIds = validateIds(input.selectedAssetVersionIds);
  const contextHash = createHash('sha256')
    .update(
      JSON.stringify({
        builderVersion: input.builderVersion,
        includedMessageIds,
        selectedAssetVersionIds,
        omittedMessageCount: input.omittedMessageCount,
        characterCount: input.characterCount,
      }),
    )
    .digest('hex');
  return {
    ...input,
    includedMessageIds,
    selectedAssetVersionIds,
    contextHash,
  };
}

function toSnapshot(
  row: typeof turnContextSnapshots.$inferSelect,
): TurnContextSnapshot {
  return {
    id: row.id,
    sessionId: row.sessionId,
    turnId: row.turnId,
    builderVersion: row.builderVersion,
    includedMessageIds: row.includedMessageIds,
    selectedAssetVersionIds: row.selectedAssetVersionIds,
    omittedMessageCount: row.omittedMessageCount,
    characterCount: row.characterCount,
    contextHash: row.contextHash,
    createdAt: row.createdAt.toISOString(),
  };
}

/** 持久化可回放的上下文证据；相同 Turn 重放必须得到完全一致的快照。 */
export class DrizzleTurnContextRepository {
  constructor(private readonly providedDatabase?: Database) {}

  private get database(): Database {
    return this.providedDatabase ?? getDb();
  }

  async recordOrGet(
    input: RecordTurnContextInput,
  ): Promise<TurnContextSnapshot> {
    if (!UUID_PATTERN.test(input.turnId)) {
      throw new TurnContextConflictError();
    }
    const prepared = prepareTurnContextMaterial(input);

    return this.database.transaction(async (transaction) => {
      const [owned] = await transaction
        .select({ id: lessonSessions.id })
        .from(lessonSessions)
        .where(
          and(
            eq(lessonSessions.id, input.sessionId),
            eq(lessonSessions.studentId, input.trustedStudentId),
          ),
        )
        .limit(1);
      if (!owned) throw new LearningSessionOwnershipError();

      await transaction
        .insert(turnContextSnapshots)
        .values({
          sessionId: input.sessionId,
          turnId: input.turnId,
          builderVersion: input.builderVersion,
          includedMessageIds: prepared.includedMessageIds,
          selectedAssetVersionIds: prepared.selectedAssetVersionIds,
          omittedMessageCount: input.omittedMessageCount,
          characterCount: input.characterCount,
          contextHash: prepared.contextHash,
          createdAt: input.now ?? new Date(),
        })
        .onConflictDoNothing({
          target: [turnContextSnapshots.sessionId, turnContextSnapshots.turnId],
        });
      const [row] = await transaction
        .select()
        .from(turnContextSnapshots)
        .where(
          and(
            eq(turnContextSnapshots.sessionId, input.sessionId),
            eq(turnContextSnapshots.turnId, input.turnId),
          ),
        )
        .limit(1);
      if (!row || row.contextHash !== prepared.contextHash) {
        throw new TurnContextConflictError();
      }
      return toSnapshot(row);
    });
  }
}
