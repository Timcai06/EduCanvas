import { GeneralChatEntry } from '@/features/workspace/general/general-chat-entry';
import { redirect } from 'next/navigation';
import { notebookConversationPath } from '@/server/platform/general-conversation';
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
  if (data) {
    const path = notebookConversationPath(data.conversation);
    redirect(
      focusTarget
        ? `${path}?focus=${encodeURIComponent(`${focusTarget.kind}:${focusTarget.resourceId}`)}`
        : path,
    );
  }
  return <GeneralChatEntry nickname={user?.nickname} />;
}
