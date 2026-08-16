import { GeneralChatEntry } from '@/features/workspace/general/general-chat-entry';
import { GeneralChatWorkspace } from '@/features/workspace/general/general-chat-workspace';
import { parseHomeFocusParam } from '@/features/workspace/general/home-focus';
import { readCurrentWebUser } from '@/server/auth/current-user';
import { loadGeneralChatPageData } from '@/server/platform/general-conversation';

/**
 * 保持首页为低认知负担的单入口，让首次使用的学生直接进入学习主流程。
 * 产品入口原则见 docs/01-product/01-产品定义.md。
 *
 * `?focus=<kind>:<resourceId>`（DP08 Web handoff 落点）：消费一次性凭证后
 * 带此参数打开，workspace 定位到精确资源；未消费/非法参数一律走默认入口。
 */
export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const focusTarget = parseHomeFocusParam(raw.focus);
  const [data, user] = await Promise.all([
    loadGeneralChatPageData(),
    readCurrentWebUser(),
  ]);
  return data ? (
    <GeneralChatWorkspace
      key={data.conversation.id}
      initialMessages={data.initialMessages}
      conversationId={data.conversation.id}
      notebookId={data.conversation.spaceId}
      notebookTitle={data.conversation.title}
      nickname={user?.nickname}
      focusTarget={focusTarget}
    />
  ) : (
    <GeneralChatEntry nickname={user?.nickname} />
  );
}
