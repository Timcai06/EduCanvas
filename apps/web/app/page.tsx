import { GeneralChatEntry } from '@/features/workspace/general/general-chat-entry';
import { GeneralChatWorkspace } from '@/features/workspace/general/general-chat-workspace';
import { loadGeneralChatPageData } from '@/server/platform/general-conversation';

/**
 * 保持首页为低认知负担的单入口，让首次使用的学生直接进入学习主流程。
 * 产品入口原则见 docs/01-product/product-definition.md。
 */
export default async function HomePage() {
  const data = await loadGeneralChatPageData();
  return data ? (
    <GeneralChatWorkspace initialMessages={data.initialMessages} />
  ) : (
    <GeneralChatEntry />
  );
}
