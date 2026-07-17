'use server';

import { redirect } from 'next/navigation';
import {
  createAnonymousIdentity,
  readAnonymousIdentity,
  writeAnonymousIdentityCookie,
} from '@/server/identity/anonymous-identity';
import {
  createGeneralConversation,
  writeActiveConversationCookie,
} from '@/server/platform/general-conversation';
import { DrizzlePlatformConversationRepository } from '@educanvas/db';

/** 默认入口只创建通用Agent Conversation，不隐式创建课程、掌握度或教学Session。 */
export async function startGeneralChatAction(): Promise<void> {
  const identity = (await readAnonymousIdentity()) ?? createAnonymousIdentity();
  const conversation = await createGeneralConversation(identity);
  await writeAnonymousIdentityCookie(identity.token);
  await writeActiveConversationCookie(conversation.id);
  redirect('/');
}

export async function startNewGeneralChatAction(): Promise<void> {
  const identity = (await readAnonymousIdentity()) ?? createAnonymousIdentity();
  const conversation = await createGeneralConversation(identity);
  await writeAnonymousIdentityCookie(identity.token);
  await writeActiveConversationCookie(conversation.id);
  redirect('/');
}

/** 切换历史对话:仅当目标会话归属当前主体时写入游标,越权静默忽略并回到当前页。 */
export async function switchConversationAction(
  conversationId: string,
): Promise<void> {
  const identity = await readAnonymousIdentity();
  if (identity) {
    const conversations = new DrizzlePlatformConversationRepository();
    const owned = await conversations.getOwned({
      conversationId,
      trustedSubjectId: identity.studentId,
    });
    if (owned) await writeActiveConversationCookie(owned.id);
  }
  redirect('/');
}
