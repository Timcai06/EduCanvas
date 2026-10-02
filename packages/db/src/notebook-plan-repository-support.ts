import { and, eq } from 'drizzle-orm';
import { getDb } from './client';
import { requireNotebookAccess } from './notebook-access';
import {
  assets,
  assetVersions,
  conversations,
  learningGoals,
  notebookChapters,
  notebookPlans,
  notebookMemberships,
  spaces,
} from './schema';

type Database = ReturnType<typeof getDb>;
type Executor =
  Database | Parameters<Parameters<Database['transaction']>[0]>[0];
export type NotebookPlanSource =
  | { kind: 'conversation'; conversationId: string }
  | { kind: 'chapter'; chapterId: string }
  | { kind: 'purpose'; purpose: string };
export type NotebookChapterLocator =
  { kind: 'whole' } | { kind: 'pages' | 'text'; start: number; end: number };
export interface NotebookPlanSnapshot {
  id: string;
  notebookId: string;
  title: string;
  description: string;
  status: 'active' | 'completed' | 'archived';
  source: NotebookPlanSource;
  available: boolean;
  goalId: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface NotebookChapterSnapshot {
  id: string;
  notebookId: string;
  assetId: string;
  assetVersionId: string;
  title: string;
  locator: NotebookChapterLocator;
  origin: 'user_grouped';
  available: boolean;
}
export class NotebookPlanInputError extends Error {
  readonly code = 'invalid_notebook_plan';
}
export class NotebookPlanConflictError extends Error {
  readonly code = 'notebook_plan_conflict';
}
export class NotebookPlanNotFoundError extends Error {
  readonly code = 'resource_not_found';
}
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function requireIds(...ids: string[]) {
  if (ids.some((id) => !uuidPattern.test(id)))
    throw new NotebookPlanInputError();
}
export function validText(value: string, maximum: number, minimum = 1) {
  const result = value.normalize('NFC').trim();
  if (result.length < minimum || result.length > maximum)
    throw new NotebookPlanInputError();
  return result;
}
export function validLocator(locator: NotebookChapterLocator): boolean {
  return (
    locator.kind === 'whole' ||
    (['pages', 'text'].includes(locator.kind) &&
      Number.isSafeInteger(locator.start) &&
      Number.isSafeInteger(locator.end) &&
      locator.start >= (locator.kind === 'pages' ? 1 : 0) &&
      locator.end >= locator.start)
  );
}
export function sameLocator(
  a: NotebookChapterLocator,
  b: NotebookChapterLocator,
) {
  return (
    a.kind === b.kind &&
    (a.kind === 'whole' ||
      (b.kind !== 'whole' && a.start === b.start && a.end === b.end))
  );
}
export async function requireAccess(
  executor: Executor,
  notebookId: string,
  trustedSubjectId: string,
  write: boolean,
  chapter = false,
) {
  if (write) {
    await executor
      .select({ notebookId: notebookMemberships.notebookId })
      .from(notebookMemberships)
      .where(
        and(
          eq(notebookMemberships.notebookId, notebookId),
          eq(notebookMemberships.userId, trustedSubjectId),
        ),
      )
      .for('update');
    await executor
      .select({ id: spaces.id })
      .from(spaces)
      .where(eq(spaces.id, notebookId))
      .for('share');
  }
  return requireNotebookAccess(executor, {
    notebookId,
    trustedSubjectId,
    requiredPermission: write
      ? chapter
        ? 'source.write'
        : 'conversation.create'
      : 'notebook.read',
  });
}
export async function sourceVersionAvailable(
  executor: Executor,
  notebookId: string,
  assetId: string,
  assetVersionId: string,
  lock = false,
) {
  const query = executor
    .select({ id: assets.id, extractedText: assetVersions.extractedText })
    .from(assets)
    .innerJoin(
      assetVersions,
      and(
        eq(assetVersions.id, assetVersionId),
        eq(assetVersions.assetId, assets.id),
      ),
    )
    .where(
      and(
        eq(assets.id, assetId),
        eq(assets.spaceId, notebookId),
        eq(assets.status, 'ready'),
        eq(assets.currentVersionId, assetVersionId),
        eq(assetVersions.status, 'ready'),
      ),
    )
    .limit(1);
  const [row] = await (lock
    ? query.for('share', { of: [assets, assetVersions] })
    : query);
  return row ?? null;
}
export async function sourceAvailable(
  executor: Executor,
  notebookId: string,
  source: NotebookPlanSource,
  lock = false,
) {
  if (source.kind === 'purpose') return true;
  if (source.kind === 'conversation') {
    const query = executor
      .select({ id: conversations.id })
      .from(conversations)
      .where(
        and(
          eq(conversations.id, source.conversationId),
          eq(conversations.spaceId, notebookId),
          eq(conversations.status, 'active'),
        ),
      )
      .limit(1);
    const [row] = await (lock ? query.for('share') : query);
    return !!row;
  }
  const query = executor
    .select()
    .from(notebookChapters)
    .where(
      and(
        eq(notebookChapters.id, source.chapterId),
        eq(notebookChapters.notebookId, notebookId),
      ),
    )
    .limit(1);
  const [chapter] = await (lock ? query.for('share') : query);
  return (
    !!chapter &&
    !!(await sourceVersionAvailable(
      executor,
      notebookId,
      chapter.assetId,
      chapter.assetVersionId,
      lock,
    ))
  );
}
export function rowSource(
  row: typeof notebookPlans.$inferSelect,
): NotebookPlanSource {
  if (row.sourceKind === 'conversation')
    return { kind: 'conversation', conversationId: row.conversationId! };
  if (row.sourceKind === 'chapter')
    return { kind: 'chapter', chapterId: row.chapterId! };
  return { kind: 'purpose', purpose: row.purpose! };
}
export function planSnapshot(
  row: typeof notebookPlans.$inferSelect,
  available: boolean,
  goalId: string | null,
): NotebookPlanSnapshot {
  return {
    id: row.id,
    notebookId: row.notebookId,
    title: row.title,
    description: row.description,
    status: row.status as NotebookPlanSnapshot['status'],
    source: rowSource(row),
    available,
    goalId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
export async function personalNotebookGoal(
  executor: Executor,
  notebookId: string,
  trustedSubjectId: string,
) {
  const [goal] = await executor
    .select({
      id: learningGoals.id,
      topic: learningGoals.topic,
      desiredOutcome: learningGoals.desiredOutcome,
      status: learningGoals.status,
    })
    .from(learningGoals)
    .where(
      and(
        eq(learningGoals.notebookId, notebookId),
        eq(learningGoals.studentId, trustedSubjectId),
        eq(learningGoals.status, 'active'),
      ),
    )
    .limit(1);
  return goal ?? null;
}
