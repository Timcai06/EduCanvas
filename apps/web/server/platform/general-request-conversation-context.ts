import 'server-only';

import { DrizzlePlatformConversationRepository } from '@educanvas/db';
import type { AnonymousIdentity } from '../identity/anonymous-identity';
import {
  loadOwnedGeneralConversation,
  loadOwnedGeneralConversationForSubject,
} from './general-conversation';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOTEBOOK = 'requestNotebookId';
const CONVERSATION = 'requestConversationId';

export function hasGeneralRequestContext(request?: Request): boolean {
  if (!request) return false;
  const query = new URL(request.url).searchParams;
  return query.has(NOTEBOOK) || query.has(CONVERSATION);
}

/** 显式 URL 上下文必须完整、唯一且经过所有权关联验证；失败不得退回跨标签 Cookie。 */
export async function loadOwnedGeneralRequestConversation(
  identity: AnonymousIdentity,
  request?: Request,
  allowedProfiles: readonly string[] = ['general'],
) {
  if (!request || !hasGeneralRequestContext(request)) {
    return loadOwnedGeneralConversation(identity);
  }
  return loadOwnedGeneralRequestConversationForSubject(
    identity.studentId,
    request,
    allowedProfiles,
  );
}

export async function loadOwnedGeneralRequestConversationForSubject(
  subjectId: string,
  request?: Request,
  allowedProfiles: readonly string[] = ['general'],
) {
  if (!request || !hasGeneralRequestContext(request))
    return loadOwnedGeneralConversationForSubject(subjectId);
  const query = new URL(request.url).searchParams;
  const notebookIds = query.getAll(NOTEBOOK);
  const conversationIds = query.getAll(CONVERSATION);
  if (
    notebookIds.length !== 1 ||
    conversationIds.length !== 1 ||
    !UUID.test(notebookIds[0]!) ||
    !UUID.test(conversationIds[0]!)
  )
    return null;
  const conversation =
    await new DrizzlePlatformConversationRepository().getOwned({
      conversationId: conversationIds[0]!,
      trustedSubjectId: subjectId,
    });
  return conversation &&
    allowedProfiles.includes(conversation.agentProfileId) &&
    conversation.spaceId.toLowerCase() === notebookIds[0]!.toLowerCase()
    ? conversation
    : null;
}

/** 课程与通用 Conversation 共享 Notebook 资源；运行入口仍单独限制自己的 Profile。 */
export function loadOwnedNotebookResourceRequestConversation(
  identity: AnonymousIdentity,
  request?: Request,
) {
  return loadOwnedGeneralRequestConversation(identity, request, [
    'general',
    'k12.teacher',
  ]);
}

/** BFF 内部转发沿用已经验证的显式 Notebook/Conversation，不重新读取 Cookie。 */
export function forwardGeneralRequestContext(
  target: string,
  request: Request,
): string {
  const url = new URL(target, request.url);
  const query = new URL(request.url).searchParams;
  for (const key of [NOTEBOOK, CONVERSATION]) {
    for (const value of query.getAll(key)) url.searchParams.append(key, value);
  }
  return url.toString();
}
