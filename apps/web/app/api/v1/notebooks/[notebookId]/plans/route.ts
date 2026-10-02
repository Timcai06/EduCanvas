import {
  notebookPlanRead,
  notebookPlanWrite,
  type NotebookPlanRouteContext,
} from '@/server/study/notebook-plan-http';
import {
  createNotebookPlan,
  createNotebookPlanSchema,
  listNotebookPlans,
} from '@/server/study/notebook-plan-service';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function GET(_request: Request, context: NotebookPlanRouteContext) {
  return notebookPlanRead(context, listNotebookPlans);
}
export function POST(request: Request, context: NotebookPlanRouteContext) {
  return notebookPlanWrite(
    request,
    context,
    createNotebookPlanSchema,
    async (notebookId, subjectId, input) => ({
      plan: await createNotebookPlan(notebookId, subjectId, input),
    }),
  );
}
