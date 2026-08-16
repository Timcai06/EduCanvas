import { createHash } from 'node:crypto';
import { redirect } from 'next/navigation';
import { readAnonymousIdentity } from '@/server/identity/anonymous-identity';
import { writeActiveConversationCookie } from '@/server/platform/general-conversation';
import { DrizzleGatewayHandoffRepository } from '@educanvas/db';
import {
  gatewayHandoffTokenSchema,
  type GatewayHandoffTarget,
} from '@educanvas/gateway-core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 跨客户端交接落点：TUI/桌宠带短期一次性凭证打开这里，把浏览器切到同一个
 * 笔记本，让"换了个窗口"成立。DP08 起凭证可精确指向资源目标：消费成功后
 * 首页带 `?focus=<kind>:<id>` 打开，workspace 定位到该资源。
 *
 * 边界：PostgreSQL 只允许凭证归属主体在到期前原子消费一次；原始凭证不落库，
 * Conversation ID 也不再出现在 URL。非法、过期、重放或跨主体请求统一静默回到
 * `/`，既不泄露拒绝原因，也不写当前对话游标。这是导航副作用，故入口仍为 GET。
 */
export async function GET(request: Request): Promise<Response> {
  const token = new URL(request.url).searchParams.get('token');
  const parsed = gatewayHandoffTokenSchema.safeParse(token);
  if (parsed.success) {
    const identity = await readAnonymousIdentity();
    if (identity) {
      const handoffs = new DrizzleGatewayHandoffRepository();
      const result = await handoffs.consume({
        tokenDigest: createHash('sha256')
          .update(parsed.data, 'utf8')
          .digest('hex'),
        trustedSubjectId: identity.studentId,
      });
      if (result.status === 'consumed') {
        await writeActiveConversationCookie(result.conversationId);
        redirect(toHomePathWithFocus(result.target));
      }
    }
  }
  redirect('/');
}

/** 凭证 target → 首页 focus 路径；message/conversation/null 均回首页。 */
function toHomePathWithFocus(target: GatewayHandoffTarget | null): string {
  if (target?.kind === 'artifact')
    return `/?focus=artifact:${target.artifactId}`;
  if (target?.kind === 'resource') {
    return `/?focus=${target.resourceKind === 'source' ? 'source' : 'artifact'}:${target.resourceId}`;
  }
  return '/';
}
