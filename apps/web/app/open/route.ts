import { redirect } from 'next/navigation';
import { readAnonymousIdentity } from '@/server/identity/anonymous-identity';
import { writeActiveConversationCookie } from '@/server/platform/general-conversation';
import { DrizzlePlatformConversationRepository } from '@educanvas/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 跨客户端交接落点：TUI 的 `/web` 带 `?conversation=<id>` 打开这里，把浏览器
 * 切到同一个笔记本，让"换了个窗口"成立。
 *
 * 边界：只有当前浏览器身份**确实拥有**该 Conversation 时才切换游标（本地
 * 模式下 Web 与 TUI 同为 local:owner、共享同一批对话；云端匿名身份则不拥有
 * 对方的对话）。不拥有或参数非法时静默回到 `/` 加载默认笔记本——绝不因 URL
 * 参数泄露或串用他人对话。这是导航副作用而非破坏性操作，故用 GET。
 */
export async function GET(request: Request): Promise<Response> {
  const conversationId = new URL(request.url).searchParams.get('conversation');
  if (conversationId && UUID_PATTERN.test(conversationId)) {
    const identity = await readAnonymousIdentity();
    if (identity) {
      const conversations = new DrizzlePlatformConversationRepository();
      const owned = await conversations.getOwned({
        conversationId,
        trustedSubjectId: identity.studentId,
      });
      if (owned) await writeActiveConversationCookie(owned.id);
    }
  }
  redirect('/');
}
