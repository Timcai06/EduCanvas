import { notFound } from 'next/navigation';
import { DrizzlePlatformConversationRepository } from '@educanvas/db';
import { NotebookPlanWorkspace } from '@/features/learning/notebook-plan-workspace';
import { readAnonymousIdentity } from '@/server/identity/anonymous-identity';
import { isValidConversationId } from '@/server/platform/general-conversation';
export default async function NotebookPlansPage({
  params,
}: {
  params: Promise<{ notebookId: string }>;
}) {
  const { notebookId } = await params;
  const identity = await readAnonymousIdentity();
  if (!identity || !isValidConversationId(notebookId)) notFound();
  const notebook =
    await new DrizzlePlatformConversationRepository().getNotebook({
      notebookId,
      trustedSubjectId: identity.studentId,
    });
  if (!notebook) notFound();
  return (
    <NotebookPlanWorkspace notebookId={notebookId} title={notebook.title} />
  );
}
