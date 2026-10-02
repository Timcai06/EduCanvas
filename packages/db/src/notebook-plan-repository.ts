import { and, desc, eq } from 'drizzle-orm';
import { getDb } from './client';
import { appendSecurityAuditEvent } from './security-audit-repository';
import { notebookChapters, notebookPlans } from './schema';
import {
  requireIds,
  validText,
  validLocator,
  sameLocator,
  requireAccess,
  sourceVersionAvailable,
  sourceAvailable,
  rowSource,
  planSnapshot,
  personalNotebookGoal,
  NotebookPlanInputError,
  NotebookPlanConflictError,
  NotebookPlanNotFoundError,
  type NotebookPlanSource,
  type NotebookPlanSnapshot,
  type NotebookChapterLocator,
  type NotebookChapterSnapshot,
} from './notebook-plan-repository-support';
export {
  NotebookPlanInputError,
  NotebookPlanConflictError,
  NotebookPlanNotFoundError,
  type NotebookPlanSource,
  type NotebookPlanSnapshot,
  type NotebookChapterLocator,
  type NotebookChapterSnapshot,
} from './notebook-plan-repository-support';
type Database = ReturnType<typeof getDb>;
/** Notebook-scoped explicit plan management, independent of teaching transitions and mastery. */
export class DrizzleNotebookPlanRepository {
  constructor(private readonly providedDatabase?: Database) {}
  private get database() {
    return this.providedDatabase ?? getDb();
  }

  async list(input: { notebookId: string; trustedSubjectId: string }) {
    requireIds(input.notebookId);
    const access = await requireAccess(
      this.database,
      input.notebookId,
      input.trustedSubjectId,
      false,
    );
    const goal = await personalNotebookGoal(
      this.database,
      input.notebookId,
      input.trustedSubjectId,
    );
    const rows = await this.database
      .select()
      .from(notebookPlans)
      .where(eq(notebookPlans.notebookId, input.notebookId))
      .orderBy(desc(notebookPlans.createdAt), desc(notebookPlans.id));
    const plans = await Promise.all(
      rows.map(async (row) =>
        planSnapshot(
          row,
          await sourceAvailable(
            this.database,
            input.notebookId,
            rowSource(row),
          ),
          goal?.id ?? null,
        ),
      ),
    );
    return {
      plans,
      goal,
      canWrite: access.permissions.includes('conversation.create'),
    };
  }

  async listChapters(input: { notebookId: string; trustedSubjectId: string }) {
    requireIds(input.notebookId);
    const access = await requireAccess(
      this.database,
      input.notebookId,
      input.trustedSubjectId,
      false,
    );
    const rows = await this.database
      .select()
      .from(notebookChapters)
      .where(eq(notebookChapters.notebookId, input.notebookId))
      .orderBy(desc(notebookChapters.createdAt), desc(notebookChapters.id));
    const chapters = await Promise.all(
      rows.map(async (row): Promise<NotebookChapterSnapshot> => ({
        id: row.id,
        notebookId: row.notebookId,
        assetId: row.assetId,
        assetVersionId: row.assetVersionId,
        title: row.title,
        locator: row.locator,
        origin: 'user_grouped',
        available: !!(await sourceVersionAvailable(
          this.database,
          input.notebookId,
          row.assetId,
          row.assetVersionId,
        )),
      })),
    );
    return { chapters, canWrite: access.permissions.includes('source.write') };
  }

  async create(input: {
    notebookId: string;
    trustedSubjectId: string;
    clientRequestId: string;
    title: string;
    description?: string;
    source: NotebookPlanSource;
  }) {
    requireIds(input.notebookId, input.clientRequestId);
    const title = validText(input.title, 120);
    const description = validText(input.description ?? '', 5000, 0);
    const source =
      input.source.kind === 'purpose'
        ? {
            kind: 'purpose' as const,
            purpose: validText(input.source.purpose, 500),
          }
        : input.source;
    if (source.kind === 'conversation') requireIds(source.conversationId);
    else if (source.kind === 'chapter') requireIds(source.chapterId);
    else if (source.kind !== 'purpose') throw new NotebookPlanInputError();
    return this.database.transaction(async (transaction) => {
      await requireAccess(
        transaction,
        input.notebookId,
        input.trustedSubjectId,
        true,
      );
      if (!(await sourceAvailable(transaction, input.notebookId, source, true)))
        throw new NotebookPlanNotFoundError();
      const [created] = await transaction
        .insert(notebookPlans)
        .values({
          notebookId: input.notebookId,
          createdByUserId: input.trustedSubjectId,
          clientRequestId: input.clientRequestId,
          title,
          description,
          sourceKind: source.kind,
          conversationId:
            source.kind === 'conversation' ? source.conversationId : null,
          chapterId: source.kind === 'chapter' ? source.chapterId : null,
          purpose: source.kind === 'purpose' ? source.purpose : null,
        })
        .onConflictDoNothing({
          target: [
            notebookPlans.notebookId,
            notebookPlans.createdByUserId,
            notebookPlans.clientRequestId,
          ],
        })
        .returning();
      const [row] = created
        ? [created]
        : await transaction
            .select()
            .from(notebookPlans)
            .where(
              and(
                eq(notebookPlans.notebookId, input.notebookId),
                eq(notebookPlans.createdByUserId, input.trustedSubjectId),
                eq(notebookPlans.clientRequestId, input.clientRequestId),
              ),
            )
            .limit(1);
      if (
        !row ||
        row.title !== title ||
        row.description !== description ||
        JSON.stringify(rowSource(row)) !== JSON.stringify(source)
      )
        throw new NotebookPlanConflictError();
      if (created)
        await appendSecurityAuditEvent(transaction, {
          actorUserId: input.trustedSubjectId,
          eventType: 'notebook_plan.created',
          resourceType: 'notebook_plan',
          resourceId: row.id,
          outcome: 'succeeded',
          metadata: { notebook_id: input.notebookId, source_kind: source.kind },
        });
      const goal = await personalNotebookGoal(
        transaction,
        input.notebookId,
        input.trustedSubjectId,
      );
      return planSnapshot(row, true, goal?.id ?? null);
    });
  }

  async createChapter(input: {
    notebookId: string;
    trustedSubjectId: string;
    clientRequestId: string;
    assetId: string;
    assetVersionId: string;
    title: string;
    locator: NotebookChapterLocator;
  }) {
    requireIds(
      input.notebookId,
      input.clientRequestId,
      input.assetId,
      input.assetVersionId,
    );
    const title = validText(input.title, 120);
    if (!validLocator(input.locator)) throw new NotebookPlanInputError();
    return this.database.transaction(async (transaction) => {
      await requireAccess(
        transaction,
        input.notebookId,
        input.trustedSubjectId,
        true,
        true,
      );
      const asset = await sourceVersionAvailable(
        transaction,
        input.notebookId,
        input.assetId,
        input.assetVersionId,
        true,
      );
      if (!asset) throw new NotebookPlanNotFoundError();
      if (
        input.locator.kind === 'text' &&
        (!asset.extractedText || input.locator.end > asset.extractedText.length)
      )
        throw new NotebookPlanInputError();
      const [created] = await transaction
        .insert(notebookChapters)
        .values({
          notebookId: input.notebookId,
          createdByUserId: input.trustedSubjectId,
          clientRequestId: input.clientRequestId,
          assetId: input.assetId,
          assetVersionId: input.assetVersionId,
          title,
          locator: input.locator,
        })
        .onConflictDoNothing({
          target: [
            notebookChapters.notebookId,
            notebookChapters.createdByUserId,
            notebookChapters.clientRequestId,
          ],
        })
        .returning();
      const [row] = created
        ? [created]
        : await transaction
            .select()
            .from(notebookChapters)
            .where(
              and(
                eq(notebookChapters.notebookId, input.notebookId),
                eq(notebookChapters.createdByUserId, input.trustedSubjectId),
                eq(notebookChapters.clientRequestId, input.clientRequestId),
              ),
            )
            .limit(1);
      if (
        !row ||
        row.assetId !== input.assetId ||
        row.assetVersionId !== input.assetVersionId ||
        row.title !== title ||
        !sameLocator(row.locator, input.locator)
      )
        throw new NotebookPlanConflictError();
      if (created)
        await appendSecurityAuditEvent(transaction, {
          actorUserId: input.trustedSubjectId,
          eventType: 'notebook_chapter.created',
          resourceType: 'notebook_chapter',
          resourceId: row.id,
          outcome: 'succeeded',
          metadata: { notebook_id: input.notebookId },
        });
      return {
        id: row.id,
        notebookId: row.notebookId,
        assetId: row.assetId,
        assetVersionId: row.assetVersionId,
        title: row.title,
        locator: row.locator,
        origin: 'user_grouped' as const,
        available: true,
      };
    });
  }

  async updateStatus(input: {
    notebookId: string;
    trustedSubjectId: string;
    planId: string;
    status: NotebookPlanSnapshot['status'];
  }) {
    requireIds(input.notebookId, input.planId);
    if (!['active', 'completed', 'archived'].includes(input.status))
      throw new NotebookPlanInputError();
    return this.database.transaction(async (transaction) => {
      await requireAccess(
        transaction,
        input.notebookId,
        input.trustedSubjectId,
        true,
      );
      const [row] = await transaction
        .select()
        .from(notebookPlans)
        .where(
          and(
            eq(notebookPlans.id, input.planId),
            eq(notebookPlans.notebookId, input.notebookId),
          ),
        )
        .limit(1)
        .for('update');
      if (!row) throw new NotebookPlanNotFoundError();
      const available = await sourceAvailable(
        transaction,
        input.notebookId,
        rowSource(row),
        true,
      );
      if (!available && input.status !== 'archived')
        throw new NotebookPlanNotFoundError();
      const [updated] = await transaction
        .update(notebookPlans)
        .set({ status: input.status, updatedAt: new Date() })
        .where(
          and(
            eq(notebookPlans.id, row.id),
            eq(notebookPlans.notebookId, input.notebookId),
          ),
        )
        .returning();
      await appendSecurityAuditEvent(transaction, {
        actorUserId: input.trustedSubjectId,
        eventType: 'notebook_plan.status_changed',
        resourceType: 'notebook_plan',
        resourceId: row.id,
        outcome: 'succeeded',
        metadata: { notebook_id: input.notebookId, status: input.status },
      });
      const goal = await personalNotebookGoal(
        transaction,
        input.notebookId,
        input.trustedSubjectId,
      );
      return planSnapshot(updated!, available, goal?.id ?? null);
    });
  }
}
