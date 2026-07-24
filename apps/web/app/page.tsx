import { GeneralChatEntry } from '@/features/workspace/general/general-chat-entry';
import { GeneralChatWorkspace } from '@/features/workspace/general/general-chat-workspace';
import { readCurrentWebUser } from '@/server/auth/current-user';
import { loadGeneralChatPageData } from '@/server/platform/general-conversation';

/**
 * 保持首页为低认知负担的单入口，让首次使用的学生直接进入学习主流程。
 * 产品入口原则见 docs/01-product/product-definition.md。
 */
export default async function HomePage() {
  const [data, user] = await Promise.all([
    loadGeneralChatPageData(),
    readCurrentWebUser(),
  ]);
  return data ? (
    <GeneralChatWorkspace
      key={data.conversation.id}
      initialMessages={data.initialMessages}
      conversationId={data.conversation.id}
      notebookTitle={data.conversation.title}
      nickname={user?.nickname}
    />
  ) : (
    <GeneralChatEntry nickname={user?.nickname} />
  );
}
