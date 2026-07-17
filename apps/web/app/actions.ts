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
