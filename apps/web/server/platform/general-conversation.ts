import 'server-only';

import {
  DrizzlePlatformConversationRepository,
  DrizzlePlatformArtifactTurnReferenceRepository,
  DrizzlePlatformSourceRepository,
  DrizzlePlatformTurnRepository,
  type PlatformConversationSnapshot,
} from '@educanvas/db';
import { cookies } from 'next/headers';
import type { InitialChatMessageDTO } from '@/features/chat/messages';
import {
  readAnonymousIdentity,
  type AnonymousIdentity,
} from '../identity/anonymous-identity';

const ACTIVE_CONVERSATION_COOKIE =
  process.env.NODE_ENV === 'production'
    ? '__Host-educanvas_active_conversation'
    : 'educanvas_active_conversation';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

const conversations = new DrizzlePlatformConversationRepository();
const turns = new DrizzlePlatformTurnRepository();
const sources = new DrizzlePlatformSourceRepository();
const artifactReferences = new DrizzlePlatformArtifactTurnReferenceRepository();

export interface GeneralChatPageData {
  conversation: PlatformConversationSnapshot;
  initialMessages: readonly InitialChatMessageDTO[];
}

/** 只读取并校验 HttpOnly 当前对话游标；不得把畸形 Cookie 传入数据库 UUID 查询。 */
export async function readActiveConversationId(): Promise<string | null> {
  const value = (await cookies()).get(ACTIVE_CONVERSATION_COOKIE)?.value;
  return value && UUID.test(value) ? value : null;
}

/** HTTP 边界在访问 PostgreSQL UUID 列之前使用同一规范校验。 */
export function isValidConversationId(value: string): boolean {
  return UUID.test(value);
}

/** 仅在显式Server Action成功创建Conversation后写入当前对话游标。 */
export async function writeActiveConversationCookie(
  conversationId: string,
): Promise<void> {
  if (!UUID.test(conversationId)) throw new Error('Conversation ID格式非法');
  (await cookies()).set(ACTIVE_CONVERSATION_COOKIE, conversationId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: COOKIE_MAX_AGE_SECONDS,
  });
}

export async function clearActiveConversationCookie(): Promise<void> {
  (await cookies()).delete(ACTIVE_CONVERSATION_COOKIE);
}

export async function createGeneralConversation(
  identity: AnonymousIdentity,
): Promise<PlatformConversationSnapshot> {
  return conversations.create({
    ownerSubjectId: identity.studentId,
    spaceKind: 'notebook',
    spaceTitle: '未命名笔记本',
    agentProfileId: 'general',
  });
}

/** Route和Server Component都从可信身份与HttpOnly游标恢复当前通用Conversation。 */
export async function loadOwnedGeneralConversation(
  identity: AnonymousIdentity,
): Promise<PlatformConversationSnapshot | null> {
  return loadOwnedGeneralConversationForSubject(identity.studentId);
}

/**
 * 已解析 effective subject 的只读入口。调用方只能传服务端可信 dataOwnerId，
 * 避免为复用旧接口伪造匿名 token 或重复读取 session/cookie 身份。
 */
export async function loadOwnedGeneralConversationForSubject(
  ownerSubjectId: string,
): Promise<PlatformConversationSnapshot | null> {
  const loadRecent = async () =>
    (
      await conversations.listOwnedRecent({
        trustedSubjectId: ownerSubjectId,
        agentProfileId: 'general',
        limit: 1,
      })
    )[0] ?? null;
  const conversationId = await readActiveConversationId();
  if (!conversationId) {
    return ownerSubjectId.startsWith('anon:') ? null : loadRecent();
  }
  const active = await conversations.getOwned({
    conversationId,
    trustedSubjectId: ownerSubjectId,
  });
  return active?.agentProfileId === 'general' ? active : loadRecent();
}

export async function loadGeneralChatPageData(): Promise<GeneralChatPageData | null> {
  const identity = await readAnonymousIdentity();
  if (!identity) return null;
  const conversation = await loadOwnedGeneralConversation(identity);
  if (!conversation || conversation.agentProfileId !== 'general') return null;
  const messages = await turns.listMessages({
    conversationId: conversation.id,
    trustedSubjectId: identity.studentId,
    limit: 100,
  });
  const citations = await sources.listOwnedConversationCitations({
    conversationId: conversation.id,
    trustedSubjectId: identity.studentId,
  });
  const referencedArtifacts = await artifactReferences.listForOperations({
    conversationId: conversation.id,
    trustedSubjectId: identity.studentId,
    operationIds: messages.map((message) => message.operationId),
  });
  const artifactsByOperation = new Map<
    string,
    (typeof referencedArtifacts)[number][]
  >();
  for (const reference of referencedArtifacts) {
    artifactsByOperation.set(reference.operationId, [
      ...(artifactsByOperation.get(reference.operationId) ?? []),
      reference,
    ]);
  }
  const citationsByMessage = new Map<string, typeof citations>();
  for (const citation of citations) {
    citationsByMessage.set(citation.assistantMessageId, [
      ...(citationsByMessage.get(citation.assistantMessageId) ?? []),
      citation,
    ]);
  }
  return {
    conversation,
    initialMessages: messages.map((message) => ({
      id: message.id,
      turnId: message.operationId,
      clientMessageId: message.clientMessageId,
      role: message.role === 'user' ? 'student' : 'assistant',
      status: message.role === 'user' ? 'completed' : message.status,
      content: message.content,
      parts: message.parts,
      artifacts:
        message.role === 'assistant'
          ? (artifactsByOperation.get(message.operationId) ?? []).map(
              ({ artifact, generationStatus }) => ({
                id: artifact.id,
                kind: artifact.kind,
                title: artifact.title,
                status:
                  artifact.latestVersion === 0 &&
                  (generationStatus === 'failed' ||
                    generationStatus === 'cancelled')
                    ? generationStatus
                    : artifact.status,
                latestVersion: artifact.latestVersion,
              }),
            )
          : undefined,
      citations:
        message.role === 'assistant'
          ? (citationsByMessage.get(message.id) ?? []).map((citation) => ({
              id: citation.citationId,
              marker: citation.ordinal,
              kind: 'web' as const,
              assetId: citation.assetId,
              assetVersionId: citation.assetVersionId,
              label: citation.label,
              url: citation.url,
              pageStart: null,
              pageEnd: null,
            }))
          : undefined,
      failureCode: message.failureCode,
      createdAt: message.createdAt,
      completedAt: message.completedAt,
    })),
  };
}
