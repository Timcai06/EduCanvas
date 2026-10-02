import {
  notebookPlanWrite,
  type NotebookPlanRouteContext,
} from '@/server/study/notebook-plan-http';
import {
  updateNotebookPlan,
  updateNotebookPlanSchema,
} from '@/server/study/notebook-plan-service';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function PATCH(request: Request, context: NotebookPlanRouteContext) {
  return notebookPlanWrite(
    request,
    context,
    updateNotebookPlanSchema,
    async (notebookId, subjectId, input, planId) => ({
      plan: await updateNotebookPlan(notebookId, planId!, subjectId, input),
    }),
  );
}
