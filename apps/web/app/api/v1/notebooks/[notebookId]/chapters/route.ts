import {
  notebookPlanRead,
  notebookPlanWrite,
  type NotebookPlanRouteContext,
} from '@/server/study/notebook-plan-http';
import {
  createNotebookChapter,
  createNotebookChapterSchema,
  listNotebookChapters,
} from '@/server/study/notebook-plan-service';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function GET(_request: Request, context: NotebookPlanRouteContext) {
  return notebookPlanRead(context, listNotebookChapters);
}
export function POST(request: Request, context: NotebookPlanRouteContext) {
  return notebookPlanWrite(
    request,
    context,
    createNotebookChapterSchema,
    async (notebookId, subjectId, input) => ({
      chapter: await createNotebookChapter(notebookId, subjectId, input),
    }),
  );
}
