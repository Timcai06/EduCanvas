import { notFound } from 'next/navigation';
import { DrizzlePlatformConversationRepository } from '@educanvas/db';
import { NotebookConversationEntry } from '@/features/workspace/general/notebook-conversation-entry';
import { parseHomeFocusParam } from '@/features/workspace/general/home-focus';
import { readAnonymousIdentity } from '@/server/identity/anonymous-identity';
import { readCurrentWebUser } from '@/server/auth/current-user';
import {
  isValidConversationId,
  loadGeneralChatPageData,
} from '@/server/platform/general-conversation';
import { isWebSearchConfigured } from '@/server/tools/web-search';
import { DEEP_RESEARCH_UNAVAILABLE_MESSAGE } from '@/features/errors/public-error';
export default async function NotebookConversationPage({
  params,
  searchParams,
}: {
  params: Promise<{ notebookId: string; conversationId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ids = await params;
  if (
    !isValidConversationId(ids.notebookId) ||
    !isValidConversationId(ids.conversationId)
  )
    notFound();
  const identity = await readAnonymousIdentity();
  if (!identity) notFound();
  const [data, notebook, user, query] = await Promise.all([
    loadGeneralChatPageData(ids),
    new DrizzlePlatformConversationRepository().getNotebook({
      notebookId: ids.notebookId,
      trustedSubjectId: identity.studentId,
    }),
    readCurrentWebUser(),
    searchParams,
  ]);
  if (!data || !notebook) notFound();
  return (
    <NotebookConversationEntry
      key={data.conversation.id}
      initialMessages={data.initialMessages}
      conversationId={data.conversation.id}
      notebookId={notebook.id}
      notebookTitle={notebook.title}
      nickname={user?.nickname}
      focusTarget={parseHomeFocusParam(query.focus)}
      deepResearchUnavailableReason={
        isWebSearchConfigured() ? null : DEEP_RESEARCH_UNAVAILABLE_MESSAGE
      }
    />
  );
}
