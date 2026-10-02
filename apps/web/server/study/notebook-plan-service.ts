import 'server-only';
import { randomUUID } from 'node:crypto';
import { DrizzleNotebookPlanRepository } from '@educanvas/db';
import { z } from 'zod';

const uuid = z.string().uuid();
const sourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('conversation'), conversationId: uuid }).strict(),
  z.object({ kind: z.literal('chapter'), chapterId: uuid }).strict(),
  z
    .object({
      kind: z.literal('purpose'),
      purpose: z.string().trim().min(1).max(500),
    })
    .strict(),
]);
export const createNotebookPlanSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    description: z.string().trim().max(5000).optional(),
    source: sourceSchema,
    clientRequestId: uuid.optional(),
  })
  .strict();
const range = {
  start: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  end: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
};
export const createNotebookChapterSchema = z
  .object({
    assetId: uuid,
    assetVersionId: uuid,
    title: z.string().trim().min(1).max(120),
    clientRequestId: uuid.optional(),
    locator: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('whole') }).strict(),
      z.object({ kind: z.literal('pages'), ...range }).strict(),
      z.object({ kind: z.literal('text'), ...range }).strict(),
    ]),
  })
  .strict();
export const updateNotebookPlanSchema = z
  .object({ status: z.enum(['active', 'completed', 'archived']) })
  .strict();
const repository = new DrizzleNotebookPlanRepository();
export function listNotebookPlans(
  notebookId: string,
  trustedSubjectId: string,
) {
  return repository.list({ notebookId, trustedSubjectId });
}
export function listNotebookChapters(
  notebookId: string,
  trustedSubjectId: string,
) {
  return repository.listChapters({ notebookId, trustedSubjectId });
}
export function createNotebookPlan(
  notebookId: string,
  trustedSubjectId: string,
  input: z.infer<typeof createNotebookPlanSchema>,
) {
  return repository.create({
    ...input,
    notebookId,
    trustedSubjectId,
    clientRequestId: input.clientRequestId ?? randomUUID(),
  });
}
export function createNotebookChapter(
  notebookId: string,
  trustedSubjectId: string,
  input: z.infer<typeof createNotebookChapterSchema>,
) {
  return repository.createChapter({
    ...input,
    notebookId,
    trustedSubjectId,
    clientRequestId: input.clientRequestId ?? randomUUID(),
  });
}
export function updateNotebookPlan(
  notebookId: string,
  planId: string,
  trustedSubjectId: string,
  input: z.infer<typeof updateNotebookPlanSchema>,
) {
  return repository.updateStatus({
    ...input,
    notebookId,
    planId,
    trustedSubjectId,
  });
}
