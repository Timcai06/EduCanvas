import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { DrizzlePlatformConversationRepository } from '@educanvas/db';
import { readAnonymousIdentity } from '@/server/identity/anonymous-identity';
import {
  isValidConversationId,
  notebookConversationPath,
} from '@/server/platform/general-conversation';
import { NotebookDirectory } from '@/features/workspace/general/notebook-directory';
export default async function NotebookPage({
  params,
}: {
  params: Promise<{ notebookId: string }>;
}) {
  const { notebookId } = await params;
  if (!isValidConversationId(notebookId)) notFound();
  const identity = await readAnonymousIdentity();
  if (!identity) notFound();
  const repository = new DrizzlePlatformConversationRepository();
  const notebook = await repository.getNotebook({
    notebookId,
    trustedSubjectId: identity.studentId,
  });
  if (!notebook) notFound();
  const conversations = await repository.listInNotebook({
    notebookId,
    trustedSubjectId: identity.studentId,
  });
  if (conversations[0]) redirect(notebookConversationPath(conversations[0]));
  return (
    <main className="min-h-dvh bg-canvas p-6 text-ink">
      <NotebookDirectory notebookId={notebookId} />
      <h1 className="mt-8 text-2xl font-semibold">{notebook.title}</h1>
      <p className="mt-3 text-ink-muted">
        这本笔记本还没有对话。在列表中创建第一条对话。
      </p>
      <Link
        className="mt-5 inline-block text-accent underline"
        href={`/notebook/${notebookId}/plans`}
      >
        查看学习计划
      </Link>
    </main>
  );
}
