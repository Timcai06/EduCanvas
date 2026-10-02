import { publicArtifactSchema } from '@educanvas/canvas-protocol';
import { and, eq } from 'drizzle-orm';
import { getDb } from './client';
import { canvasArtifacts, masteryStates } from './schema';
import type {
  LearningSessionScope,
  OwnedLearningSession,
  LearningPageSnapshot,
} from './learning-session-repository';
export async function readLearningPageSnapshot(
  database:
    | ReturnType<typeof getDb>
    | Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0],
  getCurrentOwned: (
    scope: LearningSessionScope,
  ) => Promise<OwnedLearningSession | null>,
  scope: LearningSessionScope,
  artifactId: string,
): Promise<LearningPageSnapshot | null> {
  const session = await getCurrentOwned(scope);
  if (!session) return null;

  const [artifactRow] = await database
    .select()
    .from(canvasArtifacts)
    .where(
      and(
        eq(canvasArtifacts.sessionId, session.sessionId),
        eq(canvasArtifacts.artifactId, artifactId),
      ),
    )
    .limit(1);
  if (!artifactRow) return null;

  const [masteryRow] = await database
    .select()
    .from(masteryStates)
    .where(
      and(
        eq(masteryStates.studentId, scope.studentId),
        eq(masteryStates.knowledgeNodeId, scope.knowledgeNodeId),
      ),
    )
    .limit(1);

  return {
    ...session,
    artifact: publicArtifactSchema.parse({
      schemaVersion: artifactRow.schemaVersion,
      artifactId: artifactRow.artifactId,
      type: artifactRow.type,
      title: artifactRow.title,
      params: artifactRow.params,
    }),
    mastery: masteryRow
      ? {
          masteryScore: masteryRow.masteryScore,
          attemptCount: masteryRow.attemptCount,
          correctCount: masteryRow.correctCount,
          hintCount: masteryRow.hintCount,
          nextReviewAt: masteryRow.nextReviewAt?.toISOString() ?? null,
        }
      : null,
  };
}
