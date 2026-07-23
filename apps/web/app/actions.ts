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

/** 默认入口创建一个Notebook Space及其主Conversation，不隐式创建教学Session。 */
export async function startGeneralChatAction(): Promise<void> {
  const identity = (await readAnonymousIdentity()) ?? createAnonymousIdentity();
  const conversation = await createGeneralConversation(identity);
  if (identity.studentId.startsWith('anon:')) {
    await writeAnonymousIdentityCookie(identity.token);
  }
  await writeActiveConversationCookie(conversation.id);
  redirect('/');
}

export async function startNewGeneralChatAction(): Promise<void> {
  const identity = (await readAnonymousIdentity()) ?? createAnonymousIdentity();
  const conversation = await createGeneralConversation(identity);
  if (identity.studentId.startsWith('anon:')) {
    await writeAnonymousIdentityCookie(identity.token);
  }
  await writeActiveConversationCookie(conversation.id);
  redirect('/');
}

/** 切换笔记本:当前一对一投影以主Conversation为游标，越权静默忽略。 */
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
